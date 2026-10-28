namespace server.Application.Github;

public interface IGithubAuthRateLimiter
{
    Task<bool> TryConsumeAsync(string clientAddress, string operationId);
}
