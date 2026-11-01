using System.IO.Compression;
using System.Text;
using System.Text.Json;
using server.Application.Rooms;

namespace server.Application.Projects;

public static class ImportedSnapshotValidator
{
    public const string CompressedPrefix = "gzip:v1:";
    public const int MaxCompressedSnapshotBytes = 5 * 1024 * 1024 + 8;
    public const int MaxExpandedSnapshotBytes = 16 * 1024 * 1024;

    public static string StoreCompressed(string compressedSnapshot) =>
        compressedSnapshot.StartsWith(CompressedPrefix, StringComparison.Ordinal)
            ? compressedSnapshot
            : CompressedPrefix + compressedSnapshot;

    public static string Decompress(string compressedSnapshot, long maximumBytes)
    {
        try
        {
            var payload = compressedSnapshot.StartsWith(CompressedPrefix, StringComparison.Ordinal)
                ? compressedSnapshot[CompressedPrefix.Length..]
                : compressedSnapshot;
            using var source = new MemoryStream(Convert.FromBase64String(payload));
            using var gzip = new GZipStream(source, CompressionMode.Decompress);
            using var output = new MemoryStream();
            var buffer = new byte[8192];
            int read;
            while ((read = gzip.Read(buffer, 0, buffer.Length)) > 0)
            {
                if (output.Length + read > maximumBytes)
                    throw new RoomOperationException("The folder import exceeds the per-file size limit.");
                output.Write(buffer, 0, read);
            }
            return new UTF8Encoding(false, true).GetString(output.ToArray());
        }
        catch (RoomOperationException)
        {
            throw;
        }
        catch (Exception exception) when (exception is FormatException or DecoderFallbackException or IOException)
        {
            throw new RoomOperationException("The folder import contains an invalid file snapshot.");
        }
    }

    public static long Validate(string snapshotJson, long maximumContentBytes)
    {
        using var document = Parse(snapshotJson);
        var (clock, chars) = ReadSnapshotHeader(document.RootElement);

        long index = 0;
        long contentBytes = 0;
        string? siteId = null;
        foreach (var character in chars.EnumerateArray())
        {
            index++;
            var characterInfo = ValidateCharacter(character, index, siteId);
            siteId = characterInfo.SiteId;
            contentBytes += characterInfo.ContentBytes;
        }

        if (clock != index || contentBytes > maximumContentBytes)
            throw new RoomOperationException("The folder import exceeds the per-file size limit.");
        return contentBytes;
    }

    private static (long Clock, JsonElement Characters) ReadSnapshotHeader(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object ||
            !root.TryGetProperty("clock", out var clockValue) ||
            !clockValue.TryGetInt64(out var clock) || clock < 0 ||
            !root.TryGetProperty("chars", out var characters) ||
            characters.ValueKind != JsonValueKind.Array || characters.GetArrayLength() > 65_536)
            throw InvalidSnapshot();
        return (clock, characters);
    }

    private static (string SiteId, long ContentBytes) ValidateCharacter(
        JsonElement character,
        long expectedCounter,
        string? previousSiteId)
    {
        var id = ReadCharacterId(character);
        ValidateCharacterId(id, expectedCounter, previousSiteId);
        var value = ReadCharacterValue(character);
        ValidateCharacterValue(value);
        ValidateOrigin(character, id.SiteId, expectedCounter);
        return (id.SiteId, Encoding.UTF8.GetByteCount(value));
    }

    private static void ValidateCharacterId(
        (string SiteId, long Counter) id,
        long expectedCounter,
        string? previousSiteId)
    {
        if (id.SiteId.Length is < 1 or > 128 ||
            !id.SiteId.All(character => char.IsAsciiLetterOrDigit(character) || character is '-' or '_') ||
            previousSiteId is not null && previousSiteId != id.SiteId || id.Counter != expectedCounter)
            throw InvalidSnapshot();
    }

    private static void ValidateCharacterValue(string value)
    {
        if (value.EnumerateRunes().Count() != 1 || value.Contains('\0')) throw InvalidSnapshot();
    }

    private static JsonDocument Parse(string snapshotJson)
    {
        try
        {
            return JsonDocument.Parse(snapshotJson);
        }
        catch (JsonException)
        {
            throw InvalidSnapshot();
        }
    }

    private static (string SiteId, long Counter) ReadCharacterId(JsonElement character)
    {
        if (character.ValueKind != JsonValueKind.Object ||
            !character.TryGetProperty("id", out var id) || id.ValueKind != JsonValueKind.Object ||
            !id.TryGetProperty("siteId", out var site) || site.ValueKind != JsonValueKind.String ||
            !id.TryGetProperty("counter", out var counter) || !counter.TryGetInt64(out var value) ||
            !character.TryGetProperty("isDeleted", out var deleted) || deleted.ValueKind != JsonValueKind.False)
            throw InvalidSnapshot();
        return (site.GetString()!, value);
    }

    private static string ReadCharacterValue(JsonElement character)
    {
        if (!character.TryGetProperty("value", out var value) || value.ValueKind != JsonValueKind.String)
            throw InvalidSnapshot();
        return value.GetString()!;
    }

    private static void ValidateOrigin(JsonElement character, string siteId, long index)
    {
        if (!character.TryGetProperty("originId", out var origin)) throw InvalidSnapshot();
        if (index == 1)
        {
            if (origin.ValueKind != JsonValueKind.Null) throw InvalidSnapshot();
            return;
        }

        if (origin.ValueKind != JsonValueKind.Object ||
            !origin.TryGetProperty("siteId", out var originSite) || originSite.ValueKind != JsonValueKind.String ||
            originSite.GetString() != siteId ||
            !origin.TryGetProperty("counter", out var originCounter) ||
            !originCounter.TryGetInt64(out var previousCounter) || previousCounter != index - 1)
            throw InvalidSnapshot();
    }

    private static RoomOperationException InvalidSnapshot() =>
        new("The folder import contains an invalid file snapshot.");
}
