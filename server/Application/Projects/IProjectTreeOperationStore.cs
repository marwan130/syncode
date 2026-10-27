namespace server.Application.Projects;

public interface IProjectTreeOperationStore
{
    Task<int> AppendProjectTreeOperationAsync(
        string roomId,
        string operationId,
        string operationJson,
        string siteId,
        long counter);

    Task<IReadOnlyList<string>> GetProjectTreeOperationsAsync(string roomId);
    Task<string?> GetProjectTreeOperationAsync(string roomId, string operationId);
    Task<string?> GetProjectTreeSnapshotAsync(string roomId);
}
