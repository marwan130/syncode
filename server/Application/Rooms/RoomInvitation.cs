namespace server.Application.Rooms;

public sealed record RoomInvitation(string RoomId, string AccessKey, string CreatorToken);
