using System.Collections.Concurrent;

namespace server.Application.Projects;

public sealed class ProjectImportCancellationRegistry
{
    private readonly ConcurrentDictionary<string, CancellationTokenSource> _imports = new();

    public ImportCancellation Begin(string connectionId, string importId)
    {
        var key = Key(connectionId, importId);
        var source = new CancellationTokenSource();
        if (!_imports.TryAdd(key, source))
        {
            source.Dispose();
            throw new InvalidOperationException("An import with this identifier is already running.");
        }
        return new ImportCancellation(key, source, _imports);
    }

    public bool Cancel(string connectionId, string importId) =>
        _imports.TryGetValue(Key(connectionId, importId), out var source) && Cancel(source);

    private static bool Cancel(CancellationTokenSource source)
    {
        try
        {
            source.Cancel();
            return true;
        }
        catch (ObjectDisposedException)
        {
            return false;
        }
    }

    private static string Key(string connectionId, string importId) =>
        $"{connectionId}:{importId}";

    public sealed class ImportCancellation(
        string key,
        CancellationTokenSource source,
        ConcurrentDictionary<string, CancellationTokenSource> imports) : IDisposable
    {
        public CancellationToken Token => source.Token;

        public void Dispose()
        {
            imports.TryRemove(new KeyValuePair<string, CancellationTokenSource>(key, source));
            source.Dispose();
        }
    }
}
