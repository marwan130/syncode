namespace server.Application.Projects;

public interface IProjectTreeStateReader
{
    Task<Dictionary<string, ProjectEntry>> GetEntriesAsync(string roomId);
    Task<IReadOnlyList<string>> GetFileIdsAsync(string roomId);
    Task<bool> IsFileAsync(string roomId, string fileId);
    Task<bool> IsKnownEntryAsync(string roomId, string entryId);
    Task<bool> WouldCreateParentCycleAsync(string roomId, string entryId, string parentId);
}
