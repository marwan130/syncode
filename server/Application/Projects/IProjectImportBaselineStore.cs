namespace server.Application.Projects;

public interface IProjectImportBaselineStore
{
    Task<GithubRepositoryBaseline?> GetAsync(string roomId);
    Task SetAsync(string roomId, GithubRepositoryBaseline? baseline);
}
