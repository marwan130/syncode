namespace server.Services;

public sealed class TerminalSessionRegistry
{
    private const int MaxPerConnection = 3;
    private readonly object _gate = new();
    private readonly Dictionary<string, (string ConnectionId, string RoomId)> _sessions = new(StringComparer.Ordinal);
    private readonly Dictionary<string, Queue<DateTimeOffset>> _commandTimes = new(StringComparer.Ordinal);
    private readonly Dictionary<string, Queue<DateTimeOffset>> _pollTimes = new(StringComparer.Ordinal);
    private readonly Dictionary<string, (string ConnectionId, string RoomId, DateTimeOffset CreatedAt, Queue<DateTimeOffset> InputTimes)> _executions = new(StringComparer.Ordinal);

    public bool TryAddExecution(string connectionId, string roomId, string jobId)
    {
        lock (_gate)
        {
            PurgeExpiredExecutions(DateTimeOffset.UtcNow);
            if (_executions.TryGetValue(jobId, out var existing))
                return existing.ConnectionId == connectionId && existing.RoomId == roomId;
            if (_executions.Count >= 1000) return false;
            _executions[jobId] = (connectionId, roomId, DateTimeOffset.UtcNow, new Queue<DateTimeOffset>());
            return true;
        }
    }

    public bool OwnsExecution(string connectionId, string roomId, string jobId)
    {
        lock (_gate)
        {
            PurgeExpiredExecutions(DateTimeOffset.UtcNow);
            return _executions.TryGetValue(jobId, out var execution) &&
                execution.ConnectionId == connectionId && execution.RoomId == roomId;
        }
    }

    public bool AllowExecutionInput(string connectionId, string roomId, string jobId)
    {
        lock (_gate)
        {
            PurgeExpiredExecutions(DateTimeOffset.UtcNow);
            if (!_executions.TryGetValue(jobId, out var execution) || execution.ConnectionId != connectionId || execution.RoomId != roomId) return false;
            var now = DateTimeOffset.UtcNow;
            while (execution.InputTimes.TryPeek(out var oldest) && now - oldest > TimeSpan.FromSeconds(10)) execution.InputTimes.Dequeue();
            if (execution.InputTimes.Count >= 80) return false;
            execution.InputTimes.Enqueue(now);
            return true;
        }
    }

    public void RemoveExecution(string jobId)
    {
        lock (_gate) _executions.Remove(jobId);
    }

    public string[] RemoveExecutions(string connectionId)
    {
        lock (_gate)
        {
            var ids = _executions.Where(pair => pair.Value.ConnectionId == connectionId).Select(pair => pair.Key).ToArray();
            foreach (var id in ids) _executions.Remove(id);
            return ids;
        }
    }

    private void PurgeExpiredExecutions(DateTimeOffset now)
    {
        foreach (var id in _executions.Where(pair => now - pair.Value.CreatedAt > TimeSpan.FromMinutes(15))
                     .Select(pair => pair.Key).ToArray())
            _executions.Remove(id);
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
