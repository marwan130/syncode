namespace server.Application.Execution;

public interface ITerminalSessionRegistry
{
    bool TryAddExecution(string connectionId, string roomId, string jobId);
    bool OwnsExecution(string connectionId, string roomId, string jobId);
    bool AllowExecutionInput(string connectionId, string roomId, string jobId);
    bool RemoveExecution(string jobId);
    bool TryRemoveExecution(string connectionId, string roomId, string jobId);
    string[] RemoveExecutions(string connectionId);
    (string[] SessionIds, string[] ExecutionIds) RemoveRoom(string roomId);
    bool TryAdd(string connectionId, string roomId, string sessionId);
    bool Owns(string connectionId, string roomId, string sessionId);
    bool Remove(string connectionId, string roomId, string sessionId);
    string[] RemoveAll(string connectionId);
    bool AllowCommand(string connectionId, string roomId, string sessionId);
    bool AllowPoll(string connectionId, string roomId, string sessionId);
}
