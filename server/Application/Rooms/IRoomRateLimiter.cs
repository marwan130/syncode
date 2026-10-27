namespace server.Application.Rooms;

public interface IRoomRateLimiter
{
    Task<bool> TryConsumeChatAsync(string roomId, string connectionId, string messageId);
}
