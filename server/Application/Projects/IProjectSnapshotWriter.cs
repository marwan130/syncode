namespace server.Application.Projects;

public interface IProjectSnapshotWriter
{
    Task SaveFileSnapshotAsync(string roomId, string fileId, string snapshot);
}
