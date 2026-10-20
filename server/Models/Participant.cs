namespace server.Models;

public record Participant(
    string ConnectionId,
    string DisplayName,
    string Color,
    string UserId = "",
    bool IsAdmin = false,
    bool IsLocked = false,
    string InstanceId = "",
    string? AvatarUrl = null);
