namespace server.Application.Projects;

public interface IProjectImportQuotaStore
{
    Task<bool> TryReserveProjectImportBytesAsync(
        string roomId,
        long incomingBytes,
        long maximumBytes);
    Task<bool> TryReplaceProjectImportBytesAsync(
        string roomId,
        long incomingBytes,
        long maximumBytes);
}
