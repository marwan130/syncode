namespace server.Application.Projects;

public interface IProjectEntryStore
{
    Task<IReadOnlyList<ProjectEntry>> GetEntriesAsync(string roomId);
}
