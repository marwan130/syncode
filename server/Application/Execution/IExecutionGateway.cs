using server.Application.Projects;

namespace server.Application.Execution;

public interface IExecutionGateway
{
    Task<TerminalSessionStartResult> StartTerminalAsync(
        string roomId,
        IReadOnlyList<RoomWorkspaceEntry> entries,
        CancellationToken cancellationToken);

    Task CloseTerminalAsync(string sessionId, CancellationToken cancellationToken);
    Task WriteTerminalInputAsync(string sessionId, string input, CancellationToken cancellationToken);
    Task<TerminalOutputResult> ReadTerminalOutputAsync(string sessionId, int offset, CancellationToken cancellationToken);
    Task RunTerminalFileAsync(string sessionId, string language, string sourcePath,
        IReadOnlyList<RoomWorkspaceEntry> entries, CancellationToken cancellationToken);
}
