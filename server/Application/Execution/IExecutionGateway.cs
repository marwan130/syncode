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
    Task<ExecutionSubmissionResult> SubmitAsync(ExecutionSubmissionRequest request, CancellationToken cancellationToken);
    Task WriteExecutionInputAsync(string jobId, string input, CancellationToken cancellationToken);
    Task CancelExecutionAsync(string jobId, CancellationToken cancellationToken);
}
