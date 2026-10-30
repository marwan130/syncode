namespace server.Application.Execution;

public interface ITerminalSessionRegistry
{
    string[] RemoveRoom(string roomId);
    bool TryAdd(string connectionId, string roomId, string sessionId);
    bool Owns(string connectionId, string roomId, string sessionId);
    bool Remove(string connectionId, string roomId, string sessionId);
    string[] RemoveAll(string connectionId);
    bool AllowCommand(string connectionId, string roomId, string sessionId);
    bool AllowPoll(string connectionId, string roomId, string sessionId);
}
