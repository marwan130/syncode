using server.Application.Execution;

namespace server.Services;

public sealed class TerminalSessionRegistry : ITerminalSessionRegistry
{
    private const int MaxPerConnection = 3;
    private readonly object _gate = new();
    private readonly Dictionary<string, (string ConnectionId, string RoomId)> _sessions = new(StringComparer.Ordinal);
    private readonly Dictionary<string, Queue<DateTimeOffset>> _commandTimes = new(StringComparer.Ordinal);
    private readonly Dictionary<string, Queue<DateTimeOffset>> _pollTimes = new(StringComparer.Ordinal);
    public string[] RemoveRoom(string roomId)
    {
        lock (_gate)
        {
            var sessionIds = _sessions.Where(pair => pair.Value.RoomId == roomId).Select(pair => pair.Key).ToArray();
            foreach (var id in sessionIds)
            {
                _sessions.Remove(id);
                _commandTimes.Remove(id);
                _pollTimes.Remove(id);
            }
            return sessionIds;
        }
    }

    public bool TryAdd(string connectionId, string roomId, string sessionId)
    {
        lock (_gate)
        {
            var connectionCount = _sessions.Values.Count(item => item.ConnectionId == connectionId);
            if (connectionCount >= MaxPerConnection || _sessions.ContainsKey(sessionId)) return false;
            _sessions[sessionId] = (connectionId, roomId);
            _commandTimes[sessionId] = new Queue<DateTimeOffset>();
            _pollTimes[sessionId] = new Queue<DateTimeOffset>();
            return true;
        }
    }

    public bool Owns(string connectionId, string roomId, string sessionId)
    {
        lock (_gate)
        {
            return _sessions.TryGetValue(sessionId, out var session) &&
                session.ConnectionId == connectionId &&
                session.RoomId == roomId;
        }
    }

    public bool Remove(string connectionId, string roomId, string sessionId)
    {
        lock (_gate)
        {
            if (!_sessions.TryGetValue(sessionId, out var session) ||
                session.ConnectionId != connectionId ||
                session.RoomId != roomId)
            {
                return false;
            }

            _sessions.Remove(sessionId);
            _commandTimes.Remove(sessionId);
            _pollTimes.Remove(sessionId);
            return true;
        }
    }

    public string[] RemoveAll(string connectionId)
    {
        lock (_gate)
        {
            var sessionIds = _sessions
                .Where(pair => pair.Value.ConnectionId == connectionId)
                .Select(pair => pair.Key)
                .ToArray();

            foreach (var id in sessionIds)
            {
                _sessions.Remove(id);
                _commandTimes.Remove(id);
                _pollTimes.Remove(id);
            }

            return sessionIds;
        }
    }

    public bool AllowCommand(string connectionId, string roomId, string sessionId) =>
        Consume(connectionId, roomId, sessionId, _commandTimes, 80);

    public bool AllowPoll(string connectionId, string roomId, string sessionId) =>
        Consume(connectionId, roomId, sessionId, _pollTimes, 120);

    private bool Consume(string connectionId, string roomId, string sessionId, Dictionary<string, Queue<DateTimeOffset>> rates, int limit)
    {
        lock (_gate)
        {
            if (!_sessions.TryGetValue(sessionId, out var session) ||
                session.ConnectionId != connectionId ||
                session.RoomId != roomId ||
                !rates.TryGetValue(sessionId, out var times))
            {
                return false;
            }

            var now = DateTimeOffset.UtcNow;
            while (times.TryPeek(out var oldest) && now - oldest > TimeSpan.FromSeconds(10)) times.Dequeue();
            if (times.Count >= limit) return false;
            times.Enqueue(now);
            return true;
        }
    }
}
