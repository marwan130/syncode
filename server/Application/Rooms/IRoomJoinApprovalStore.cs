namespace server.Application.Rooms;

public sealed record PendingRoomJoinRequest(
    string RequestId,
    string DisplayName,
    string Color,
    string? AvatarUrl,
    string ConnectionId,
    bool IsApproved,
    bool IsStableRequestId,
    bool IsAdmin = false,
    bool IsLocked = false,
    bool RequiresApproval = false);

public sealed record RoomJoinRequestView(
    string RequestId,
    string DisplayName,
    string Color,
    string? AvatarUrl);

public interface IRoomJoinApprovalStore
{
    Task<PendingRoomJoinRequest?> GetApprovedMemberAsync(string roomId, string requestId, string connectionId);
    Task<bool> HasApprovedAdminAsync(string roomId);
    Task<bool> IsApprovedRequestAsync(string roomId, string requestId, string connectionId);
    Task SaveMemberAsync(
        string roomId,
        string requestId,
        string connectionId,
        string displayName,
        string color,
        string? avatarUrl,
        bool isAdmin,
        bool isLocked);
    Task RemoveMemberAsync(string roomId, string requestId);
    Task UpdateMemberLockAsync(string roomId, string requestId, bool isLocked);
    Task<bool> IsRejectedAsync(string roomId, string requestId);
    Task<bool> HasHadAdminAsync(string roomId);
    Task<bool> UpsertRequestAsync(
        string roomId,
        string requestId,
        string connectionId,
        string displayName,
        string color,
        string? avatarUrl,
        int maxPendingRequests);
    Task<IReadOnlyList<RoomJoinRequestView>> GetRequestsAsync(string roomId);
    Task<PendingRoomJoinRequest?> ApproveAsync(string roomId, string requestId);
    Task<PendingRoomJoinRequest?> RejectAsync(string roomId, string requestId);
    Task RemoveRequestAsync(string roomId, string requestId, string connectionId);
}
