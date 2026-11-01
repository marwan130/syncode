namespace Syncode.ExecutionService.Runner;

internal sealed class RoomSessionCapacity
{
    private readonly object _gate = new();
    private readonly Dictionary<string, int> _active = new(StringComparer.Ordinal);

    internal bool TryAcquire(string roomId, int maximum)
    {
        lock (_gate)
        {
            var current = _active.GetValueOrDefault(roomId);
            if (current >= maximum) return false;
            _active[roomId] = current + 1;
            return true;
        }
    }

    internal void Release(string roomId)
    {
        lock (_gate)
        {
            if (!_active.TryGetValue(roomId, out var current)) return;
            if (current <= 1) _active.Remove(roomId);
            else _active[roomId] = current - 1;
        }
    }
}
