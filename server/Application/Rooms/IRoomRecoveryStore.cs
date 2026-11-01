namespace server.Application.Rooms;

public interface IRoomRecoveryStore
{
    Task ArchiveExpiredRoomAsync(string roomId);
    Task<bool> TryRestoreExpiredRoomAsync(
        string roomId,
        string accessKey,
        string? creatorToken,
        string? requestId);
    Task<bool> TryBeginWorkspaceRestoreAsync(string roomId, string requestId);
    Task<string?> GetWorkspaceRestoreStatusAsync(string roomId, string requestId);
    Task CompleteWorkspaceRestoreAsync(string roomId, string requestId);
    Task CancelWorkspaceRestoreAsync(string roomId, string requestId);
}
