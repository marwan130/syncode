using System.Text.Json;
using server.Application.Rooms;

namespace server.Application.Projects;

public sealed class ProjectImportService(
    IProjectSnapshotWriter snapshots,
    IProjectSnapshotReader snapshotReader,
    IRoomParticipantReader participants,
    IProjectImportQuotaStore importQuota,
    IProjectImportRateLimiter rateLimits,
    IProjectTreeOperationStore treeStore,
    IProjectTreeStateReader treeState,
    IProjectImportBaselineStore repositoryBaselineStore,
    IRoomActivityStore roomActivity,
    IProjectRootNameStore projectRootNames)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private const long MaxRoomImportBytes = 32 * 1024 * 1024;

    public async Task<ProjectImportResult> ImportAsync(
        string roomId,
        string connectionId,
        string importId,
        IReadOnlyList<ProjectImportFile>? files,
        GithubRepositoryBaseline? repositoryBaseline = null,
        string? projectRootName = null,
        bool replaceWorkspace = false,
        Func<int, Task>? reportProgress = null,
        bool allowRecoveryImport = false,
        CancellationToken cancellationToken = default)
    {
        var participant = await participants.GetParticipantAsync(roomId, connectionId);
        if (participant is null || (!participant.IsAdmin && !allowRecoveryImport))
            throw new RoomOperationException("Only room admins can import a folder.");
        if (!Guid.TryParseExact(importId, "N", out _) || files is null ||
            files.Count is < 1 or > 500)
            throw new RoomOperationException("The folder import is invalid or exceeds its limits.");

        var requestedRootName = repositoryBaseline is not null
            ? ProjectRootName.Normalize(repositoryBaseline.Name)
            : string.IsNullOrWhiteSpace(projectRootName)
                ? null
                : ProjectRootName.Normalize(projectRootName);
        var totalStoredBytes = ProjectImportValidator.Validate(
            files,
            repositoryBaseline,
            allowRecoveryImport);
        var currentEntries = await treeState.GetEntriesAsync(roomId);
        var entries = replaceWorkspace
            ? new Dictionary<string, ProjectEntry>(StringComparer.Ordinal)
            : currentEntries;
        var rootEntries = replaceWorkspace
            ? currentEntries.Values.Where(entry => entry.ParentId is null).ToArray()
            : [];
        var initialCounter = rootEntries.Length;
        var plan = ProjectImportPlanner.Build(entries, files, importId, initialCounter);
        if (entries.Count + plan.NewEntryCount > 500)
            throw new RoomOperationException("A room can contain up to 500 files and folders.");

        if (!await rateLimits.TryConsumeProjectImportAsync(
                roomId, connectionId, Guid.NewGuid().ToString("N")))
            throw new RoomOperationException("Folder import rate limit reached. Wait before importing again.");
        var fileIds = plan.ImportedFiles.Select(file => file.Entry.Id).Distinct().ToArray();
        var previousSnapshots = replaceWorkspace
            ? new Dictionary<string, string?>()
            : await ReadPreviousSnapshotsAsync(roomId, fileIds);
        List<ImportedProjectFileSnapshot> importedFiles;
        try
        {
            importedFiles = await SaveSnapshotsAsync(
                roomId, plan.ImportedFiles, reportProgress, cancellationToken);
            cancellationToken.ThrowIfCancellationRequested();
        }
        catch
        {
            await RestoreSnapshotsAsync(roomId, fileIds, previousSnapshots);
            throw;
        }

        var quotaReserved = replaceWorkspace
            ? await importQuota.TryReplaceProjectImportBytesAsync(roomId, totalStoredBytes, MaxRoomImportBytes)
            : await importQuota.TryReserveProjectImportBytesAsync(roomId, totalStoredBytes, MaxRoomImportBytes);
        if (!quotaReserved)
        {
            await RestoreSnapshotsAsync(roomId, fileIds, previousSnapshots);
            throw new RoomOperationException("This room has reached its folder import storage limit.");
        }

        if (replaceWorkspace)
        {
            for (var index = 0; index < rootEntries.Length; index++)
            {
                plan.Operations.Insert(index, new ProjectTreeMutation(
                    "delete",
                    new ProjectTreeOperationId($"import-{importId}", index + 1),
                    EntryId: rootEntries[index].Id));
            }
        }
        await PersistOperationsAsync(roomId, plan.Operations, plan.ChangedOperations);
        if (replaceWorkspace)
        {
            var oldFileIds = currentEntries.Values
                .Where(entry => !entry.IsFolder)
                .Select(entry => entry.Id)
                .ToArray();
            await snapshots.DeleteFileSnapshotsAsync(roomId, oldFileIds);
        }
        await repositoryBaselineStore.SetAsync(roomId, repositoryBaseline);
        var rootName = requestedRootName ?? await projectRootNames.GetProjectRootNameAsync(roomId);
        if (rootName is not null)
            await projectRootNames.SetProjectRootNameAsync(roomId, rootName);
        await roomActivity.TouchRoomAsync(roomId);
        return new ProjectImportResult(plan.Operations, plan.ChangedOperations, importedFiles, rootName);
    }

    public Task SetRootNameAsync(string roomId, string name) =>
        projectRootNames.SetProjectRootNameAsync(roomId, ProjectRootName.Normalize(name));

    private async Task<Dictionary<string, string?>> ReadPreviousSnapshotsAsync(
        string roomId,
        IReadOnlyCollection<string> fileIds)
    {
        var snapshotsById = new Dictionary<string, string?>(StringComparer.Ordinal);
        foreach (var fileId in fileIds)
            snapshotsById[fileId] = await snapshotReader.GetFileSnapshotAsync(roomId, fileId);
        return snapshotsById;
    }

    private async Task RestoreSnapshotsAsync(
        string roomId,
        IReadOnlyCollection<string> fileIds,
        IReadOnlyDictionary<string, string?> previousSnapshots)
    {
        var newFileIds = fileIds.Where(fileId =>
            !previousSnapshots.TryGetValue(fileId, out var snapshot) || snapshot is null).ToArray();
        await snapshots.DeleteFileSnapshotsAsync(roomId, newFileIds);
        foreach (var (fileId, snapshot) in previousSnapshots)
        {
            if (snapshot is not null)
                await snapshots.SaveFileSnapshotAsync(roomId, fileId, snapshot);
        }
    }

    private async Task PersistOperationsAsync(
        string roomId,
        IReadOnlyList<ProjectTreeMutation> operations,
        List<ProjectTreeMutation> changedOperations)
    {
        foreach (var operation in operations)
        {
            var operationJson = JsonSerializer.Serialize(operation, JsonOptions);
            var result = await treeStore.AppendProjectTreeOperationAsync(
                roomId, $"{operation.OpId.SiteId}:{operation.OpId.Counter}", operationJson,
                operation.OpId.SiteId, operation.OpId.Counter,
                incomingNameKey: operation.Entry?.Name.ToUpperInvariant());
            if (result < 0)
                throw new RoomOperationException("The import stopped before all files were added. Some files may already be in the room.");
            if (result == 1) changedOperations.Add(operation);
        }
    }

    private async Task<List<ImportedProjectFileSnapshot>> SaveSnapshotsAsync(
        string roomId,
        List<(string CompressedSnapshot, ProjectTreeEntry Entry)> files,
        Func<int, Task>? reportProgress,
        CancellationToken cancellationToken)
    {
        var importedFiles = new List<ImportedProjectFileSnapshot>(files.Count);
        foreach (var (compressedSnapshot, entry) in files)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var storedSnapshot = ImportedSnapshotValidator.StoreCompressed(compressedSnapshot);
            await snapshots.SaveFileSnapshotAsync(roomId, entry.Id, storedSnapshot);
            importedFiles.Add(new ImportedProjectFileSnapshot(entry.Id, storedSnapshot));
            if (reportProgress is not null)
                await reportProgress(importedFiles.Count);
        }
        cancellationToken.ThrowIfCancellationRequested();
        return importedFiles;
    }
}
