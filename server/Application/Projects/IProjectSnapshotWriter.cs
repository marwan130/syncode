namespace server.Application.Projects;

public interface IProjectSnapshotWriter
{
    Task SaveFileSnapshotAsync(string roomId, string fileId, string snapshot);
    Task DeleteFileSnapshotsAsync(string roomId, IReadOnlyCollection<string> fileIds);
}
