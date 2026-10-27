using System.Text.Json;
using server.Application.Rooms;

namespace server.Application.Projects;

public sealed class ProjectImportService(
    IProjectSnapshotWriter snapshots,
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
        string? projectRootName = null)
    {
        var participant = await participants.GetParticipantAsync(roomId, connectionId);
        if (participant?.IsAdmin != true)
            throw new RoomOperationException("Only room admins can import a folder.");
        if (!Guid.TryParseExact(importId, "N", out _) || files is null ||
            files.Count is < 1 or > 500)
            throw new RoomOperationException("The folder import is invalid or exceeds its limits.");

        var requestedRootName = repositoryBaseline is not null
            ? ProjectRootName.Normalize(repositoryBaseline.Name)
            : string.IsNullOrWhiteSpace(projectRootName)
                ? null
                : ProjectRootName.Normalize(projectRootName);
        var totalStoredBytes = ProjectImportValidator.Validate(files, repositoryBaseline);
        var entries = await treeState.GetEntriesAsync(roomId);
        var plan = ProjectImportPlanner.Build(entries, files, importId);
        if (entries.Count + plan.NewEntryCount > 500)
            throw new RoomOperationException("A room can contain up to 500 files and folders.");

        if (!await rateLimits.TryConsumeProjectImportAsync(
                roomId, connectionId, Guid.NewGuid().ToString("N")))
            throw new RoomOperationException("Folder import rate limit reached. Wait before importing again.");
        if (!await importQuota.TryReserveProjectImportBytesAsync(
                roomId, totalStoredBytes, MaxRoomImportBytes))
            throw new RoomOperationException("This room has reached its folder import storage limit.");

        await PersistOperationsAsync(roomId, plan.Operations, plan.ChangedOperations);
        var importedFiles = await SaveSnapshotsAsync(roomId, plan.ImportedFiles);
        await repositoryBaselineStore.SetAsync(roomId, repositoryBaseline);
        var rootName = requestedRootName ?? await projectRootNames.GetProjectRootNameAsync(roomId);
        if (rootName is not null)
            await projectRootNames.SetProjectRootNameAsync(roomId, rootName);
        await roomActivity.TouchRoomAsync(roomId);
        return new ProjectImportResult(plan.Operations, plan.ChangedOperations, importedFiles, rootName);
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
                throw new RoomOperationException("The import stopped before all files were added. Some files may already be in the room.");
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
            await snapshots.SaveFileSnapshotAsync(roomId, entry.Id, storedSnapshot);
            importedFiles.Add(new ImportedProjectFileSnapshot(entry.Id, storedSnapshot));
        }
        return importedFiles;
    }
}
