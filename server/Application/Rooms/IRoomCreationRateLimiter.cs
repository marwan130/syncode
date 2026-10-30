namespace server.Application.Rooms;

public interface IRoomCreationRateLimiter
{
    Task<bool> TryConsumeAsync(string clientAddress, string operationId);
}
