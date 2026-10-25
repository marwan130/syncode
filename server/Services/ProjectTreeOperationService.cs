using System.Text.Json;
using Microsoft.AspNetCore.SignalR;
using server.Models;

namespace server.Services;

public sealed class ProjectTreeOperationService(
    RedisRoomRateLimitStore rateLimits,
    RedisRoomMetadataStore roomMetadata,
    RedisProjectTreeStore treeStore,
    ProjectTreeStateService state)
{
    private const long MaximumCounter = 9_007_199_254_740_991L;
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    public async Task<bool> ApplyAsync(string roomId, string connectionId, JsonElement operation)
    {
        var json = JsonSerializer.Serialize(operation);
        if (json.Length > 16 * 1024) throw new HubOperationException("Project tree update is too large.");
        var (type, siteId, counter) = ReadOperationId(operation);
        var operationId = $"{siteId}:{counter}";
        var operationValue = GetOperationValue(operation)
            ?? throw new HubOperationException("Invalid project tree update.");
        if (await IsDuplicateAsync(roomId, operationId, operationValue)) return false;

        await ValidateOperationAsync(roomId, type, operation);
        if (!await rateLimits.TryConsumeFileEntryCreateAsync(
                roomId, connectionId, Guid.NewGuid().ToString("N")))
            throw new HubOperationException("File update rate limit reached. Please wait before trying again.");

        var result = await treeStore.AppendProjectTreeOperationAsync(roomId, operationId, json, siteId, counter);
        ThrowForAppendResult(result);
        await roomMetadata.TouchRoomAsync(roomId);
        return result == 1;
    }

    private async Task<bool> IsDuplicateAsync(string roomId, string operationId, string operationValue)
    {
        var previousJson = await treeStore.GetProjectTreeOperationAsync(roomId, operationId);
        if (previousJson is null) return false;
        using var previous = JsonDocument.Parse(previousJson);
        if (GetOperationValue(previous.RootElement) != operationValue)
            throw new HubOperationException("Conflicting project tree operation ID.");
        return true;
    }

    private async Task ValidateOperationAsync(string roomId, string type, JsonElement operation)
    {
        if (type == "create") await ValidateCreateAsync(roomId, operation);
        else if (type == "rename") await ValidateRenameAsync(roomId, operation);
        else if (type == "move") await ValidateMoveAsync(roomId, operation);
        else if (type == "delete") await ValidateDeleteAsync(roomId, operation);
        else throw new HubOperationException("Unsupported project tree update.");
    }

    private async Task ValidateCreateAsync(string roomId, JsonElement operation)
    {
        if (!operation.TryGetProperty("entry", out var value))
            throw new HubOperationException("Invalid project tree entry.");
        var entry = JsonSerializer.Deserialize<ProjectEntry>(value.GetRawText(), JsonOptions);
        if (entry is null || !IsSafeIdentifier(entry.Id) ||
            entry.ParentId is { } entryParentId && !IsSafeIdentifier(entryParentId))
            throw new HubOperationException("Invalid project tree entry.");
        ValidateNormalizedName(entry.Name);
        var entries = await state.GetEntriesAsync(roomId);
        if (entries.ContainsKey(entry.Id)) throw new HubOperationException("That project entry already exists.");
        if (entries.Count >= 500) throw new HubOperationException("A room can contain up to 500 files and folders.");
        if (entry.ParentId is { } parentId)
        {
            if (!entries.TryGetValue(parentId, out var parent) || !parent.IsFolder)
                throw new HubOperationException("Parent folder no longer exists.");
            var parentPath = ProjectTreeStateService.GetEntryPath(parent, entries);
            if (parentPath is null || parentPath.Split('/').Length >= ProjectPathRules.MaximumDepth)
                throw new HubOperationException("The project folder depth limit was reached.");
        }
        var resolvedParentPath = entry.ParentId is { } folderId
            ? ProjectTreeStateService.GetEntryPath(entries[folderId], entries)
            : null;
        var path = resolvedParentPath is null ? entry.Name : $"{resolvedParentPath}/{entry.Name}";
        if (!ProjectPathRules.IsSharedPath(path))
            throw new HubOperationException("Generated files and dependency folders are not shared project files.");
    }

    private async Task ValidateRenameAsync(string roomId, JsonElement operation)
    {
        var id = ReadEntryId(operation, "Invalid project tree entry name.");
        var name = ReadString(operation, "name", "Invalid project tree entry name.");
        ValidateNormalizedName(name);
        var entries = await state.GetEntriesAsync(roomId);
        if (!entries.TryGetValue(id, out var entry))
            throw new HubOperationException("File or folder no longer exists.");
        var parentPath = entry.ParentId is { } parentId && entries.TryGetValue(parentId, out var parent)
            ? ProjectTreeStateService.GetEntryPath(parent, entries)
            : null;
        var path = parentPath is null ? name : $"{parentPath}/{name}";
        if (!ProjectPathRules.IsSharedPath(path))
            throw new HubOperationException("Generated files and dependency folders are not shared project files.");
    }

    private async Task ValidateMoveAsync(string roomId, JsonElement operation)
    {
        var id = ReadEntryId(operation, "Invalid project tree parent.");
        if (!operation.TryGetProperty("parentId", out var parentValue) ||
            parentValue.ValueKind != JsonValueKind.Null &&
            (parentValue.ValueKind != JsonValueKind.String || !IsSafeIdentifier(parentValue.GetString()!)))
            throw new HubOperationException("Invalid project tree parent.");
        var parentId = parentValue.ValueKind == JsonValueKind.String ? parentValue.GetString() : null;
        var entries = await state.GetEntriesAsync(roomId);
        if (!entries.TryGetValue(id, out var entry))
            throw new HubOperationException("File or folder no longer exists.");
        ProjectEntry? parentEntry = null;
        if (parentId is not null &&
            (!entries.TryGetValue(parentId, out parentEntry) || !parentEntry.IsFolder))
            throw new HubOperationException("Parent folder no longer exists.");
        if (parentId is not null && await state.WouldCreateParentCycleAsync(roomId, id, parentId))
            throw new HubOperationException("That move would create a folder cycle.");

        var entryPath = ProjectTreeStateService.GetEntryPath(entry, entries);
        var parentPath = parentEntry is null ? null : ProjectTreeStateService.GetEntryPath(parentEntry, entries);
        if (entryPath is null || parentEntry is not null && parentPath is null)
            throw new HubOperationException("The project tree is invalid.");
        var movedPath = parentPath is null ? entry.Name : $"{parentPath}/{entry.Name}";
        if (!ProjectPathRules.IsSharedPath(movedPath))
            throw new HubOperationException("Generated files and dependency folders are not shared project files.");
        var entryDepth = entryPath.Split('/').Length;
        var maximumRelativeDepth = entries.Values
            .Select(candidate => ProjectTreeStateService.GetEntryPath(candidate, entries))
            .Where(path => path is not null && path.StartsWith(entryPath + "/", StringComparison.Ordinal))
            .Select(path => path!.Split('/').Length - entryDepth)
            .DefaultIfEmpty(0)
            .Max();
        var newDepth = (parentPath?.Split('/').Length ?? 0) + 1;
        if (newDepth + maximumRelativeDepth > ProjectPathRules.MaximumDepth)
            throw new HubOperationException("The project folder depth limit was reached.");
    }

    private async Task ValidateDeleteAsync(string roomId, JsonElement operation)
    {
        var id = ReadEntryId(operation, "Invalid project tree entry.");
        if (!await state.IsKnownEntryAsync(roomId, id))
            throw new HubOperationException("File or folder no longer exists.");
    }

    private static (string Type, string SiteId, long Counter) ReadOperationId(JsonElement operation)
    {
        if (operation.ValueKind != JsonValueKind.Object ||
            !TryReadString(operation, "type", out var type) ||
            !operation.TryGetProperty("opId", out var id) || id.ValueKind != JsonValueKind.Object ||
            !TryReadString(id, "siteId", out var siteId) ||
            !id.TryGetProperty("counter", out var counterValue) || !counterValue.TryGetInt64(out var counter))
            throw new HubOperationException("Invalid project tree update.");
        if (string.IsNullOrWhiteSpace(siteId) || siteId.Length > 128 || siteId == "syncode-seed" ||
            counter < 1 || counter > MaximumCounter)
            throw new HubOperationException("Invalid project tree update ID.");
        return (type, siteId, counter);
    }

    private static string ReadEntryId(JsonElement operation, string error)
    {
        if (!TryReadString(operation, "entryId", out var id) || !IsSafeIdentifier(id))
            throw new HubOperationException(error);
        return id;
    }

    private static string ReadString(JsonElement value, string property, string error)
    {
        if (!TryReadString(value, property, out var result)) throw new HubOperationException(error);
        return result;
    }

    private static bool TryReadString(JsonElement value, string property, out string result)
    {
        if (value.TryGetProperty(property, out var element) && element.ValueKind == JsonValueKind.String)
        {
            result = element.GetString()!;
            return true;
        }
        result = string.Empty;
        return false;
    }

    private static void ValidateNormalizedName(string name)
    {
        if (ProjectPathRules.NormalizeName(name) != name)
            throw new HubOperationException("Project entry names must be normalized.");
    }

    private static bool IsSafeIdentifier(string value) =>
        value.Length is > 0 and <= 128 && value is not "." and not ".." &&
        value.All(character => char.IsAsciiLetterOrDigit(character) || character is '-' or '_' or '.');

    private static string? GetOperationValue(JsonElement operation)
    {
        if (!TryReadString(operation, "type", out var type)) return null;
        if (type == "create") return GetCreateValue(operation, type);
        if (type == "rename") return GetRenameValue(operation, type);
        if (type == "move") return GetMoveValue(operation, type);
        if (type == "delete") return GetDeleteValue(operation, type);
        return null;
    }

    private static string? GetCreateValue(JsonElement operation, string type)
    {
        if (!operation.TryGetProperty("entry", out var entry) || entry.ValueKind != JsonValueKind.Object ||
            !TryReadString(entry, "id", out var id) || !TryReadString(entry, "name", out var name) ||
            !entry.TryGetProperty("parentId", out var parent) ||
            !entry.TryGetProperty("isFolder", out var folder) || folder.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
            return null;
        return JsonSerializer.Serialize(new object?[] { type, id, name, parent.ValueKind == JsonValueKind.Null ? null : parent.GetString(), folder.GetBoolean() });
    }

    private static string? GetRenameValue(JsonElement operation, string type) =>
        TryReadString(operation, "entryId", out var id) && TryReadString(operation, "name", out var name)
            ? JsonSerializer.Serialize(new object?[] { type, id, name }) : null;

    private static string? GetMoveValue(JsonElement operation, string type) =>
        TryReadString(operation, "entryId", out var id) && operation.TryGetProperty("parentId", out var parent)
            ? JsonSerializer.Serialize(new object?[] { type, id, parent.ValueKind == JsonValueKind.Null ? null : parent.GetString() }) : null;

    private static string? GetDeleteValue(JsonElement operation, string type) =>
        TryReadString(operation, "entryId", out var id)
            ? JsonSerializer.Serialize(new object?[] { type, id }) : null;

    private static void ThrowForAppendResult(int result)
    {
        if (result == -1) throw new HubOperationException("Conflicting project tree update ID.");
        if (result == -3) throw new HubOperationException("That project entry already exists.");
        if (result == -2) throw new HubOperationException("Invalid project tree update.");
        if (result == -5) throw new HubOperationException("A room can contain up to 500 files and folders.");
        if (result == -6) throw new HubOperationException("The project folder depth limit was reached.");
    }
}
