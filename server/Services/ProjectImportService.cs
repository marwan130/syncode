using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.SignalR;
using server.Models;

namespace server.Services;

public sealed class ProjectImportService(
    RedisFileStore roomStore,
    RedisRoomMetadataStore roomMetadata,
    RedisRoomRateLimitStore rateLimits,
    RedisProjectTreeStore treeStore,
    ProjectTreeStateService state)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<ProjectImportResult> ImportAsync(
        string roomId,
        string connectionId,
        string creatorToken,
        string importId,
        IReadOnlyList<ProjectImportFile>? files)
    {
        if (!await roomMetadata.ValidateRoomCreatorTokenAsync(roomId, creatorToken))
            throw new HubOperationException("Only the room creator can import a folder.");
        if (!Guid.TryParseExact(importId, "N", out _) || files is null ||
            files.Count is < 1 or > 500)
            throw new HubOperationException("The folder import is invalid or exceeds its limits.");

        var validatedImport = ValidateImport(files);
        var entries = await state.GetEntriesAsync(roomId);
        var plan = BuildPlan(entries, files, validatedImport.Snapshots, importId);
        if (entries.Count + plan.NewEntryCount > 500)
            throw new HubOperationException("A room can contain up to 500 files and folders.");

        if (!await rateLimits.TryConsumeProjectImportAsync(
                roomId, connectionId, Guid.NewGuid().ToString("N")))
            throw new HubOperationException("Folder import rate limit reached. Wait before importing again.");
        if (!await roomMetadata.TryReserveProjectImportBytesAsync(
                roomId, validatedImport.TotalSnapshotBytes, MaxRoomImportBytes))
            throw new HubOperationException("This room has reached its folder import storage limit.");

        await PersistOperationsAsync(roomId, plan.Operations, plan.ChangedOperations);
        var importedFiles = await SaveSnapshotsAsync(roomId, plan.ImportedFileEntries);

        await roomMetadata.TouchRoomAsync(roomId);
        return new ProjectImportResult(plan.Operations, plan.ChangedOperations, importedFiles);
    }

    private static ValidatedImport ValidateImport(IReadOnlyList<ProjectImportFile> files)
    {
        long totalSnapshotBytes = 0;
        long totalContentBytes = 0;
        long totalCompressedBytes = 0;
        var paths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var fileIds = new HashSet<string>(StringComparer.Ordinal);
        var snapshots = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var file in files)
        {
            if (file is null || !ProjectPathRules.IsSafePath(file.Path) ||
                file.Id is null || !ProjectPathRules.IsSafeIdentifier(file.Id) ||
                !fileIds.Add(file.Id) || !paths.Add(file.Path) ||
                file.CompressedSnapshot is null ||
                Encoding.UTF8.GetByteCount(file.CompressedSnapshot) > MaxFileBytes)
                throw new HubOperationException("The folder import contains an invalid file.");

            foreach (var segment in file.Path.Split('/'))
                if (ProjectPathRules.NormalizeName(segment) != segment)
                    throw new HubOperationException("The folder import contains an invalid path.");

            totalCompressedBytes += Encoding.UTF8.GetByteCount(file.CompressedSnapshot);
            var snapshot = ImportedSnapshotValidator.Decompress(file.CompressedSnapshot, MaxFileBytes);
            totalSnapshotBytes += Encoding.UTF8.GetByteCount(snapshot);
            totalContentBytes += ImportedSnapshotValidator.Validate(snapshot, MaxFileContentBytes);
            if (totalCompressedBytes > MaxProjectCompressedBytes ||
                totalContentBytes > MaxProjectContentBytes ||
                totalSnapshotBytes > MaxProjectSnapshotBytes)
                throw new HubOperationException("The folder import exceeds the project size limit.");
            snapshots.Add(file.Id, snapshot);
        }

        return new ValidatedImport(snapshots, totalSnapshotBytes);
    }

    private static ImportPlan BuildPlan(
        IReadOnlyDictionary<string, ProjectEntry> entries,
        IReadOnlyList<ProjectImportFile> files,
        Dictionary<string, string> snapshots,
        string importId)
    {
        var entriesByPath = CreatePathIndex(entries);
        var operations = new List<ProjectTreeCreateOperation>();
        var importedFiles = new List<(string Snapshot, ProjectTreeEntry Entry)>();
        var occupiedIds = entries.Keys.ToHashSet(StringComparer.Ordinal);
        var nextCounter = 0L;

        foreach (var file in files)
        {
            string? parentId = null;
            var segments = file.Path.Split('/');
            for (var index = 0; index < segments.Length; index++)
            {
                var path = string.Join('/', segments.Take(index + 1));
                var isFile = index == segments.Length - 1;
                if (entriesByPath.TryGetValue(path, out var existing))
                {
                    if (isFile || !existing.IsFolder)
                        throw new HubOperationException("A file or folder with that path already exists.");
                    parentId = existing.Id;
                    continue;
                }

                if (entries.Count + operations.Count >= 500)
                    throw new HubOperationException("A room can contain up to 500 files and folders.");
                var id = isFile ? file.Id : Guid.NewGuid().ToString("N");
                if (!occupiedIds.Add(id))
                    throw new HubOperationException("The folder import contains a duplicate file identifier.");
                var entry = new ProjectTreeEntry(id, segments[index], parentId, !isFile);
                var operation = new ProjectTreeCreateOperation(
                    "create", new ProjectTreeOperationId($"import-{importId}", ++nextCounter), entry);
                operations.Add(operation);
                entriesByPath.Add(path, new ProjectEntry(entry.Id, entry.Name, entry.ParentId, entry.IsFolder));
                if (isFile) importedFiles.Add((snapshots[file.Id], entry));
                else parentId = id;
            }
        }

        return new ImportPlan(operations, importedFiles, operations.Count);
    }

    private static Dictionary<string, ProjectEntry> CreatePathIndex(
        IReadOnlyDictionary<string, ProjectEntry> entries)
    {
        var paths = new Dictionary<string, ProjectEntry>(StringComparer.OrdinalIgnoreCase);
        foreach (var entry in entries.Values)
        {
            var path = ProjectTreeStateService.GetEntryPath(entry, entries);
            if (path is not null && !paths.TryAdd(path, entry))
                throw new HubOperationException("The room contains conflicting file paths.");
        }
        return paths;
    }

    private async Task PersistOperationsAsync(
        string roomId,
        IReadOnlyList<ProjectTreeCreateOperation> operations,
        List<ProjectTreeCreateOperation> changedOperations)
    {
        foreach (var operation in operations)
        {
            var operationJson = JsonSerializer.Serialize(operation, JsonOptions);
            var result = await treeStore.AppendProjectTreeOperationAsync(
                roomId, $"{operation.OpId.SiteId}:{operation.OpId.Counter}", operationJson,
                operation.OpId.SiteId, operation.OpId.Counter);
            if (result < 0)
                throw new HubOperationException("The import stopped before all files were added. Some files may already be in the room.");
            if (result == 1) changedOperations.Add(operation);
        }
    }

    private async Task<List<ImportedProjectFileSnapshot>> SaveSnapshotsAsync(
        string roomId,
        List<(string Snapshot, ProjectTreeEntry Entry)> files)
    {
        var importedFiles = new List<ImportedProjectFileSnapshot>(files.Count);
        foreach (var (snapshot, entry) in files)
        {
            await roomStore.SaveFileSnapshotAsync(roomId, entry.Id, snapshot);
            importedFiles.Add(new ImportedProjectFileSnapshot(entry.Id, snapshot));
        }
        return importedFiles;
    }

    private const long MaxFileBytes = 2 * 1024 * 1024;
    private const long MaxProjectSnapshotBytes = 8 * 1024 * 1024;
    private const long MaxRoomImportBytes = 32 * 1024 * 1024;
    private const long MaxFileContentBytes = 64 * 1024;
    private const long MaxProjectContentBytes = 512 * 1024;
    private const long MaxProjectCompressedBytes = 4 * 1024 * 1024;

    private sealed record ValidatedImport(Dictionary<string, string> Snapshots, long TotalSnapshotBytes);
    private sealed record ImportPlan(
        List<ProjectTreeCreateOperation> Operations,
        List<(string Snapshot, ProjectTreeEntry Entry)> ImportedFileEntries,
        int NewEntryCount)
    {
        public List<ProjectTreeCreateOperation> ChangedOperations { get; } = [];
    }
}
