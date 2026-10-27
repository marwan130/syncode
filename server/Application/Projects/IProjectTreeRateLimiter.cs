namespace server.Application.Projects;

public interface IProjectTreeRateLimiter
{
    Task<bool> TryConsumeFileEntryCreateAsync(
        string roomId,
        string connectionId,
        string operationId);
}
