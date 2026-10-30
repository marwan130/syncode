namespace server.Application.Rooms;

public interface IRoomRateLimiter
{
    Task<bool> TryConsumeChatAsync(string roomId, string connectionId, string messageId);
    Task<bool> TryConsumeGithubRepositoryAsync(string roomId, string actorId, string operationId);
}
