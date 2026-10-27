namespace server.Application.Projects;

public interface IProjectRootNameStore
{
    Task<string?> GetProjectRootNameAsync(string roomId);
    Task SetProjectRootNameAsync(string roomId, string name);
}
