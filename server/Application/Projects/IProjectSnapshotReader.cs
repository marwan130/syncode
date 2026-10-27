namespace server.Application.Projects;

public interface IProjectSnapshotReader
{
    Task<string?> GetFileSnapshotAsync(string roomId, string fileId);
    Task<string?> GetLegacyRoomSnapshotAsync(string roomId);
}
