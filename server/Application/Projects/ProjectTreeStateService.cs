using System.Text.Json;

namespace server.Application.Projects;

public sealed class ProjectTreeStateService(
    IProjectEntryStore roomStore,
    IProjectTreeOperationStore treeStore) : IProjectTreeStateReader
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    public async Task<Dictionary<string, ProjectEntry>> GetEntriesAsync(string roomId)
    {
        var entries = (await roomStore.GetEntriesAsync(roomId))
            .ToDictionary(entry => entry.Id, StringComparer.Ordinal);
        var deletedIds = new HashSet<string>(StringComparer.Ordinal);
        var snapshot = await treeStore.GetProjectTreeSnapshotAsync(roomId);
        if (!string.IsNullOrEmpty(snapshot))
        {
            using var document = JsonDocument.Parse(snapshot);
            if (document.RootElement.TryGetProperty("operations", out var operations) &&
                operations.ValueKind == JsonValueKind.Array)
                foreach (var operation in operations.EnumerateArray())
                    ApplyOperation(operation, entries, deletedIds);
        }
        else
        {
            foreach (var operationJson in await treeStore.GetProjectTreeOperationsAsync(roomId))
            {
                using var document = JsonDocument.Parse(operationJson);
                ApplyOperation(document.RootElement, entries, deletedIds);
            }
        }

        foreach (var id in deletedIds) entries.Remove(id);
        RemoveEntriesUnderDeletedParents(entries, deletedIds);
        return entries;
    }

    public async Task<IReadOnlyList<string>> GetFileIdsAsync(string roomId) =>
        (await GetEntriesAsync(roomId))
            .Values
            .Where(entry => !entry.IsFolder)
            .Select(entry => entry.Id)
            .ToArray();

    public async Task<bool> IsFileAsync(string roomId, string fileId) =>
        (await GetEntriesAsync(roomId)).TryGetValue(fileId, out var entry) && !entry.IsFolder;

    public async Task<bool> IsKnownEntryAsync(string roomId, string entryId) =>
        (await GetEntriesAsync(roomId)).ContainsKey(entryId);

    public async Task<bool> IsKnownFolderAsync(string roomId, string folderId) =>
        (await GetEntriesAsync(roomId)).TryGetValue(folderId, out var entry) && entry.IsFolder;

    public async Task<bool> WouldCreateParentCycleAsync(string roomId, string entryId, string parentId)
    {
        var parents = (await GetEntriesAsync(roomId))
            .Values
            .ToDictionary(entry => entry.Id, entry => entry.ParentId, StringComparer.Ordinal);
        var visited = new HashSet<string>(StringComparer.Ordinal);
        string? current = parentId;
        while (current is not null)
        {
            if (current == entryId || !visited.Add(current)) return true;
            current = parents.GetValueOrDefault(current);
        }
        return false;
    }

    private static void RemoveEntriesUnderDeletedParents(
        Dictionary<string, ProjectEntry> entries,
        HashSet<string> deletedIds)
    {
        foreach (var entry in entries.Values.ToArray())
        {
            var visited = new HashSet<string>(StringComparer.Ordinal) { entry.Id };
            var parentId = entry.ParentId;
            while (parentId is not null)
            {
                if (deletedIds.Contains(parentId))
                {
                    entries.Remove(entry.Id);
                    break;
                }
                if (!visited.Add(parentId) || !entries.TryGetValue(parentId, out var parent)) break;
                parentId = parent.ParentId;
            }
        }
    }

    private static void ApplyOperation(
        JsonElement operation,
        Dictionary<string, ProjectEntry> entries,
        HashSet<string> deletedIds)
    {
        if (!operation.TryGetProperty("type", out var typeValue) || typeValue.ValueKind != JsonValueKind.String)
            return;

        var type = typeValue.GetString();
        if (type == "create") ApplyCreate(operation, entries);
        else if (type == "rename") ApplyRename(operation, entries);
        else if (type == "move") ApplyMove(operation, entries);
        else if (type == "delete") ApplyDelete(operation, deletedIds);
    }

    private static void ApplyCreate(
        JsonElement operation,
        Dictionary<string, ProjectEntry> entries)
    {
        if (!operation.TryGetProperty("entry", out var value) || value.ValueKind != JsonValueKind.Object) return;
        var entry = JsonSerializer.Deserialize<ProjectEntry>(value.GetRawText(), JsonOptions);
        if (entry is not null) entries[entry.Id] = entry;
    }

    private static void ApplyRename(
        JsonElement operation,
        Dictionary<string, ProjectEntry> entries)
    {
        if (!TryGetString(operation, "entryId", out var id) || !TryGetString(operation, "name", out var name) ||
            !entries.TryGetValue(id, out var entry)) return;
        entries[id] = entry with { Name = name };
    }

    private static void ApplyMove(
        JsonElement operation,
        Dictionary<string, ProjectEntry> entries)
    {
        if (!TryGetString(operation, "entryId", out var id) ||
            !operation.TryGetProperty("parentId", out var parent) ||
            parent.ValueKind is not (JsonValueKind.Null or JsonValueKind.String) ||
            !entries.TryGetValue(id, out var entry)) return;
        entries[id] = entry with { ParentId = parent.ValueKind == JsonValueKind.Null ? null : parent.GetString() };
    }

    private static void ApplyDelete(JsonElement operation, HashSet<string> deletedIds)
    {
        if (TryGetString(operation, "entryId", out var id)) deletedIds.Add(id);
    }

    private static bool TryGetString(JsonElement value, string property, out string result)
    {
        if (value.TryGetProperty(property, out var element) && element.ValueKind == JsonValueKind.String)
        {
            result = element.GetString()!;
            return true;
        }
        result = string.Empty;
        return false;
    }
}
