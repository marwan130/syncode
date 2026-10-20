namespace server.Services;

public sealed record RoomJoinRequest(
    string RoomId,
    string DisplayName,
    string Color,
    bool IsRoomCreator,
    string? AvatarUrl);
