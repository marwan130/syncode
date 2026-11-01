using System.Text;
using server.Application.Rooms;

namespace server.Application.Projects;

public sealed class RoomFileService(
    IProjectSnapshotWriter files,
    IRoomActivityStore rooms,
    IRoomParticipantReader participants,
    RoomAuthorizationService authorization,
    ProjectTreeOperationService projectTreeOperations)
{
    private const int MaxOfflineSnapshotCount = 500;
    private const int MaxOfflineSnapshotCompressedBytes = 10 * 1024 * 1024;
    private const int MaxOfflineSnapshotExpandedBytes = 192 * 1024 * 1024;

    public async Task SaveSnapshotAsync(
        string roomId,
        string fileId,
        string snapshotJson,
        string connectionId)
    {
        await authorization.EnsureFileParticipantAsync(roomId, fileId, connectionId);
        if (!IsSnapshotWithinLimits(snapshotJson))
            throw new RoomOperationException("Invalid file snapshot.");
        await rooms.TouchRoomAsync(roomId);
        await files.SaveFileSnapshotAsync(roomId, fileId, snapshotJson);
    }

    public async Task SaveOfflineSnapshotsAsync(
        string roomId,
        string connectionId,
        IReadOnlyList<ProjectFileSnapshot> snapshots)
    {
        if (snapshots.Count > MaxOfflineSnapshotCount)
            throw new RoomOperationException("The room workspace exceeds its recovery limit.");

        var fileIds = new HashSet<string>(StringComparer.Ordinal);
        var compressedBytes = 0;
        var expandedBytes = 0;
        foreach (var snapshot in snapshots)
        {
            if (snapshot is null || !fileIds.Add(snapshot.FileId))
                throw new RoomOperationException("The room workspace snapshot is invalid.");
            await authorization.EnsureFileParticipantAsync(roomId, snapshot.FileId, connectionId);
            var expanded = GetSnapshotExpandedBytes(snapshot.Snapshot);
            if (expanded is null)
                throw new RoomOperationException("The room workspace snapshot is invalid.");
            compressedBytes += Encoding.UTF8.GetByteCount(snapshot.Snapshot);
            expandedBytes += expanded.Value;
            if (compressedBytes > MaxOfflineSnapshotCompressedBytes ||
                expandedBytes > MaxOfflineSnapshotExpandedBytes)
                throw new RoomOperationException("The room workspace exceeds its recovery limit.");
        }

        await rooms.TouchRoomAsync(roomId);
        foreach (var snapshot in snapshots)
            await files.SaveFileSnapshotAsync(roomId, snapshot.FileId, snapshot.Snapshot);
    }

    public async Task<bool> SavePeerSnapshotAsync(
        string roomId,
        string fileId,
        string targetConnectionId,
        string snapshotJson,
        string connectionId)
    {
        await authorization.EnsureFileParticipantAsync(roomId, fileId, connectionId);
        if (!IsSnapshotWithinLimits(snapshotJson) ||
            await participants.GetConnectionRoomAsync(targetConnectionId) != roomId ||
            !await participants.IsParticipantAsync(roomId, targetConnectionId))
            return false;
        await files.SaveFileSnapshotAsync(roomId, fileId, snapshotJson);
        return true;
    }

    private static bool IsSnapshotWithinLimits(string snapshot)
    {
        return GetSnapshotExpandedBytes(snapshot) is not null;
    }

    private static int? GetSnapshotExpandedBytes(string snapshot)
    {
        if (string.IsNullOrEmpty(snapshot)) return null;
        if (!snapshot.StartsWith(
                ImportedSnapshotValidator.CompressedPrefix,
                StringComparison.Ordinal))
            return snapshot.Length <= MaxLegacySnapshotBytes
                ? Encoding.UTF8.GetByteCount(snapshot)
                : null;
        if (Encoding.UTF8.GetByteCount(snapshot) > MaxCompressedSnapshotBytes) return null;
        try
        {
            return Encoding.UTF8.GetByteCount(
                ImportedSnapshotValidator.Decompress(snapshot, MaxExpandedSnapshotBytes));
        }
        catch (RoomOperationException)
        {
            return null;
        }
    }

    private const int MaxLegacySnapshotBytes = 5_000_000;
    private const int MaxCompressedSnapshotBytes = ImportedSnapshotValidator.MaxCompressedSnapshotBytes;
    private const int MaxExpandedSnapshotBytes = ImportedSnapshotValidator.MaxExpandedSnapshotBytes;

    public async Task SendOperationAsync(
        string roomId,
        string fileId,
        string connectionId)
    {
        await authorization.EnsureFileParticipantAsync(roomId, fileId, connectionId);
        await rooms.TouchRoomAsync(roomId);
    }

    public async Task<bool> ApplyTreeOperationAsync(
        string roomId,
        System.Text.Json.JsonElement operation,
        string connectionId)
    {
        await authorization.EnsureCanEditAsync(roomId, connectionId);
        return await projectTreeOperations.ApplyAsync(roomId, connectionId, operation);
    }
}
