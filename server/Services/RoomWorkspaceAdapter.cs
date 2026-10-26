using System.Text;
using System.Text.Json;
using server.Models;

namespace server.Services;

public sealed record RoomWorkspaceEntry(
    string Path,
    bool IsFolder,
    string Content,
    string? PreviousContent = null);

public sealed class RoomWorkspaceAdapter(
    ProjectTreeStateService projectTree,
    RedisFileStore files)
{
    public const long MaximumWorkspaceBytes = 32 * 1024 * 1024;

    public async Task<IReadOnlyList<RoomWorkspaceEntry>> MaterializeAsync(string roomId)
    {
        var entries = await projectTree.GetEntriesAsync(roomId);
        var result = new List<RoomWorkspaceEntry>(entries.Count);
        long totalBytes = 0;
        foreach (var entry in entries.Values
                     .Select(entry => (Entry: entry, Path: ProjectTreeStateService.GetEntryPath(entry, entries)))
                     .Where(item => item.Path is not null)
                     .OrderBy(item => item.Path, StringComparer.Ordinal))
        {
            var path = entry.Path!;
            if (!ProjectPathRules.IsSafePath(path) || !ProjectPathRules.IsSharedPath(path)) continue;
            if (entry.Entry.IsFolder)
            {
                result.Add(new RoomWorkspaceEntry(path, true, string.Empty));
                continue;
            }

            var snapshot = await files.GetFileSnapshotAsync(roomId, entry.Entry.Id);
            var content = string.IsNullOrEmpty(snapshot) ? string.Empty : ReadVisibleContent(snapshot);
            var bytes = Encoding.UTF8.GetByteCount(content);
            totalBytes += bytes;
            if (bytes > ImportedSnapshotValidator.MaxExpandedSnapshotBytes || totalBytes > MaximumWorkspaceBytes)
                throw new HubOperationException("This room's shared files exceed the workspace size limit.");
            result.Add(new RoomWorkspaceEntry(path, false, content));
        }

        return result;
    }

    private static string ReadVisibleContent(string storedSnapshot)
    {
        var snapshot = storedSnapshot.StartsWith(ImportedSnapshotValidator.CompressedPrefix, StringComparison.Ordinal)
            ? ImportedSnapshotValidator.Decompress(storedSnapshot, ImportedSnapshotValidator.MaxExpandedSnapshotBytes)
            : storedSnapshot;
        try
        {
            using var document = JsonDocument.Parse(snapshot);
            if (!document.RootElement.TryGetProperty("chars", out var chars) || chars.ValueKind != JsonValueKind.Array ||
                chars.GetArrayLength() > 65_536)
                throw new HubOperationException("A room file has an invalid collaborative snapshot.");

            var content = new StringBuilder();
            foreach (var character in chars.EnumerateArray())
            {
                if (!character.TryGetProperty("value", out var value) || value.ValueKind != JsonValueKind.String ||
                    !character.TryGetProperty("isDeleted", out var deleted) || deleted.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
                    throw new HubOperationException("A room file has an invalid collaborative snapshot.");
                if (!deleted.GetBoolean()) content.Append(value.GetString());
            }
            return content.ToString();
        }
        catch (JsonException)
        {
            throw new HubOperationException("A room file has an invalid collaborative snapshot.");
        }
    }
}
