using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.SignalR;
using server.Models;

namespace server.Services;

public sealed class ProjectImportService(
    RedisFileStore roomStore,
    RedisParticipantStore participants,
    RedisRoomMetadataStore roomMetadata,
    RedisRoomRateLimitStore rateLimits,
    RedisProjectTreeStore treeStore,
    ProjectTreeStateService state,
    GithubRepositoryStore githubRepository)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task<ProjectImportResult> ImportAsync(
        string roomId,
        string connectionId,
        string importId,
        IReadOnlyList<ProjectImportFile>? files,
        GithubRepositoryBaseline? repositoryBaseline = null)
    {
        var participant = await participants.GetParticipantAsync(roomId, connectionId);
        if (participant?.IsAdmin != true)
            throw new HubOperationException("Only room admins can import a folder.");
        if (!Guid.TryParseExact(importId, "N", out _) || files is null ||
            files.Count is < 1 or > 500)
            throw new HubOperationException("The folder import is invalid or exceeds its limits.");

        var validatedImport = ValidateImport(files);
        ValidateRepositoryBaseline(repositoryBaseline, files);
        var entries = await state.GetEntriesAsync(roomId);
        var plan = BuildPlan(entries, files, importId);
        if (entries.Count + plan.NewEntryCount > 500)
            throw new HubOperationException("A room can contain up to 500 files and folders.");

        if (!await rateLimits.TryConsumeProjectImportAsync(
                roomId, connectionId, Guid.NewGuid().ToString("N")))
            throw new HubOperationException("Folder import rate limit reached. Wait before importing again.");
        if (!await roomMetadata.TryReserveProjectImportBytesAsync(
                roomId, validatedImport.TotalStoredBytes, MaxRoomImportBytes))
            throw new HubOperationException("This room has reached its folder import storage limit.");

        await PersistOperationsAsync(roomId, plan.Operations, plan.ChangedOperations);
        var importedFiles = await SaveSnapshotsAsync(roomId, plan.ImportedFileEntries);
        await githubRepository.SetAsync(roomId, repositoryBaseline);

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
        long totalStoredBytes = 0;
        foreach (var file in files)
        {
            if (file is null || !ProjectPathRules.IsSharedPath(file.Path) ||
                file.Id is null || !ProjectPathRules.IsSafeIdentifier(file.Id) ||
                !fileIds.Add(file.Id) || !paths.Add(file.Path) ||
                file.CompressedSnapshot is null ||
                Encoding.UTF8.GetByteCount(file.CompressedSnapshot) > MaxFileCompressedBytes)
                throw new HubOperationException("The folder import contains an invalid file.");

            foreach (var segment in file.Path.Split('/'))
                if (ProjectPathRules.NormalizeName(segment) != segment)
                    throw new HubOperationException("The folder import contains an invalid path.");

            totalCompressedBytes += Encoding.UTF8.GetByteCount(file.CompressedSnapshot);
            var storedSnapshot = ImportedSnapshotValidator.StoreCompressed(file.CompressedSnapshot);
            totalStoredBytes += Encoding.UTF8.GetByteCount(storedSnapshot);
            var snapshot = ImportedSnapshotValidator.Decompress(
                file.CompressedSnapshot,
                MaxFileSnapshotBytes);
            totalSnapshotBytes += Encoding.UTF8.GetByteCount(snapshot);
            totalContentBytes += ImportedSnapshotValidator.Validate(snapshot, MaxFileContentBytes);
            if (totalCompressedBytes > MaxProjectCompressedBytes ||
                totalContentBytes > MaxProjectContentBytes ||
                totalSnapshotBytes > MaxProjectSnapshotBytes)
                throw new HubOperationException("The folder import exceeds the project size limit.");
        }

        return new ValidatedImport(totalStoredBytes);
    }

    private static void ValidateRepositoryBaseline(
        GithubRepositoryBaseline? baseline,
        IReadOnlyList<ProjectImportFile> files)
    {
        if (baseline is null) return;
        if (!Regex.IsMatch(baseline.Owner, "^[A-Za-z0-9-]{1,39}$") ||
            !Regex.IsMatch(baseline.Name, "^[A-Za-z0-9._-]{1,100}$") ||
            !Regex.IsMatch(baseline.BaseCommitSha, "^[a-fA-F0-9]{40}$") ||
            !Regex.IsMatch(baseline.BaseTreeSha, "^[a-fA-F0-9]{40}$") ||
            string.IsNullOrWhiteSpace(baseline.Branch) ||
            baseline.Branch.Length > 255 ||
            baseline.Branch.StartsWith('/') ||
            baseline.Branch.EndsWith('/') ||
            baseline.Branch.Contains("..", StringComparison.Ordinal) ||
            baseline.Branch.Contains("@{", StringComparison.Ordinal) ||
            baseline.Branch.Any(character =>
                char.IsControl(character) || character is ' ' or '~' or '^' or ':' or '?' or '*' or '[' or '\\') ||
            baseline.FileBlobShas is null ||
            baseline.FileBlobShas.Count > 500 ||
            baseline.FileLineEndings is null ||
            baseline.FileLineEndings.Count > 500)
            throw new HubOperationException("The repository baseline is invalid.");

        var paths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var (path, sha) in baseline.FileBlobShas)
            if (!ProjectPathRules.IsSafePath(path) || !paths.Add(path) ||
                !Regex.IsMatch(sha, "^[a-fA-F0-9]{40}$"))
                throw new HubOperationException("The repository baseline is invalid.");

        foreach (var (path, lineEnding) in baseline.FileLineEndings)
            if (!paths.Contains(path) || lineEnding is not ("lf" or "crlf" or "cr"))
                throw new HubOperationException("The repository baseline is invalid.");

        var importedPaths = files.Select(file => file.Path).ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (!paths.SetEquals(importedPaths))
            throw new HubOperationException("The repository baseline does not match the imported files.");
    }

    private static ImportPlan BuildPlan(
        IReadOnlyDictionary<string, ProjectEntry> entries,
        IReadOnlyList<ProjectImportFile> files,
        string importId)
    {
        var entriesByPath = CreatePathIndex(entries);
        var operations = new List<ProjectTreeCreateOperation>();
        var importedFiles = new List<(string CompressedSnapshot, ProjectTreeEntry Entry)>();
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
                if (isFile) importedFiles.Add((file.CompressedSnapshot, entry));
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
        List<(string CompressedSnapshot, ProjectTreeEntry Entry)> files)
    {
        var importedFiles = new List<ImportedProjectFileSnapshot>(files.Count);
        foreach (var (compressedSnapshot, entry) in files)
        {
            var storedSnapshot = ImportedSnapshotValidator.StoreCompressed(compressedSnapshot);
            await roomStore.SaveFileSnapshotAsync(roomId, entry.Id, storedSnapshot);
            importedFiles.Add(new ImportedProjectFileSnapshot(entry.Id, storedSnapshot));
        }
        return importedFiles;
    }

    private const long MaxFileCompressedBytes = 1 * 1024 * 1024 + 8;
    private const long MaxFileSnapshotBytes = ImportedSnapshotValidator.MaxExpandedSnapshotBytes;
    private const long MaxProjectSnapshotBytes = 192 * 1024 * 1024;
    private const long MaxRoomImportBytes = 32 * 1024 * 1024;
    private const long MaxFileContentBytes = 64 * 1024;
    private const long MaxProjectContentBytes = 1024 * 1024;
    private const long MaxProjectCompressedBytes = 10 * 1024 * 1024;

    private sealed record ValidatedImport(long TotalStoredBytes);
    private sealed record ImportPlan(
        List<ProjectTreeCreateOperation> Operations,
        List<(string CompressedSnapshot, ProjectTreeEntry Entry)> ImportedFileEntries,
        int NewEntryCount)
    {
        public List<ProjectTreeCreateOperation> ChangedOperations { get; } = [];
    }
}
