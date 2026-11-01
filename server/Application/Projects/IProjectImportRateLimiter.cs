namespace server.Application.Projects;

public interface IProjectImportRateLimiter
{
    Task<bool> TryConsumeProjectImportAsync(
        string roomId,
        string connectionId,
        string importId);
}
