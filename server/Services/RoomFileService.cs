using System.Text;
using server.Models;

namespace server.Services;

public sealed class RoomFileService(
    RedisFileStore files,
    RedisRoomMetadataStore rooms,
    RedisParticipantStore participants,
    RoomAuthorizationService authorization,
    ProjectTreeOperationService projectTreeOperations)
{
    public async Task SaveSnapshotAsync(
        string roomId,
        string fileId,
        string snapshotJson,
        string connectionId)
    {
        await authorization.EnsureFileParticipantAsync(roomId, fileId, connectionId);
        if (!IsSnapshotWithinLimits(snapshotJson))
            throw new HubOperationException("Invalid file snapshot.");
        await rooms.TouchRoomAsync(roomId);
        await files.SaveFileSnapshotAsync(roomId, fileId, snapshotJson);
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
        if (string.IsNullOrEmpty(snapshot)) return false;
        if (!snapshot.StartsWith(
                ImportedSnapshotValidator.CompressedPrefix,
                StringComparison.Ordinal))
            return snapshot.Length <= MaxLegacySnapshotBytes;
        if (Encoding.UTF8.GetByteCount(snapshot) > MaxCompressedSnapshotBytes) return false;
        try
        {
            _ = ImportedSnapshotValidator.Decompress(snapshot, MaxExpandedSnapshotBytes);
            return true;
        }
        catch (HubOperationException)
        {
            return false;
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
