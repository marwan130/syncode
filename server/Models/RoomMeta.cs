namespace server.Models;

public record RoomMeta(string RoomId, DateTimeOffset CreatedAt, DateTimeOffset LastActivity);
