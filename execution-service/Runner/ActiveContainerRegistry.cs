using System.Collections.Concurrent;

namespace Syncode.ExecutionService.Runner;

public sealed class ActiveContainerRegistry
{
    private readonly ConcurrentDictionary<string, byte> _containers = new(StringComparer.Ordinal);

    public bool Contains(string name) => _containers.ContainsKey(name);

    internal void Add(string name) => _containers.TryAdd(name, 0);

    internal void Remove(string name) => _containers.TryRemove(name, out _);
}
