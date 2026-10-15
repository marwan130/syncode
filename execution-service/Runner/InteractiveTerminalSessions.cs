using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text;
using Syncode.ExecutionService.Security;

namespace Syncode.ExecutionService.Runner;

public sealed record TerminalSessionStart(string SessionId);
public sealed record TerminalSessionOutput(string Text, int Offset, bool Exited, int? ExitCode);
public sealed class TerminalSessionLimitException(string message) : Exception(message);

public sealed class InteractiveTerminalSessions : IHostedService, IAsyncDisposable
{
    private const int MaxSessions = 16;
    private const int MaxOutputCharacters = 256 * 1024;
    private const int MaxInputCharacters = 4096;
    private static readonly TimeSpan IdleLifetime = TimeSpan.FromMinutes(15);
    private static readonly TimeSpan MaximumLifetime = TimeSpan.FromHours(1);
    private readonly ConcurrentDictionary<string, Session> _sessions = new(StringComparer.Ordinal);
    private readonly string _docker;
    private readonly ILogger<InteractiveTerminalSessions> _logger;
    private readonly ActiveContainerRegistry _activeContainers;
    private readonly SemaphoreSlim _sessionSlots = new(MaxSessions, MaxSessions);
    private readonly CancellationTokenSource _shutdown = new();
    private Task? _cleanupTask;

    public InteractiveTerminalSessions(
        IConfiguration configuration,
        ILogger<InteractiveTerminalSessions> logger,
        ActiveContainerRegistry activeContainers)
    {
        _docker = configuration["ExecutionService:DockerCli"] ?? "docker";
        _logger = logger;
        _activeContainers = activeContainers;
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        _cleanupTask = CleanupLoopAsync(_shutdown.Token);
        return Task.CompletedTask;
    }

    public async Task<TerminalSessionStart> CreateAsync(CancellationToken cancellationToken)
    {
        if (!await _sessionSlots.WaitAsync(0, cancellationToken))
            throw new TerminalSessionLimitException("The terminal session limit has been reached. Close an unused terminal and try again.");

        var id = Guid.NewGuid().ToString("N");
        var containerName = $"syncode-terminal-{id}";
        var startInfo = new ProcessStartInfo
        {
            FileName = _docker,
            UseShellExecute = false,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };
        foreach (var argument in BuildArguments(containerName)) startInfo.ArgumentList.Add(argument);

        var process = new Process { StartInfo = startInfo, EnableRaisingEvents = true };
        _activeContainers.Add(containerName);
        try
        {
            if (!process.Start()) throw new InvalidOperationException("Could not start the isolated Bash terminal.");
            var session = new Session(id, containerName, process);
            if (!_sessions.TryAdd(id, session))
            {
                _activeContainers.Remove(containerName);
                throw new InvalidOperationException("Could not allocate a terminal session.");
            }
            session.OutputTask = Task.WhenAll(
                PumpAsync(session, process.StandardOutput, _shutdown.Token),
                PumpAsync(session, process.StandardError, _shutdown.Token));
            session.ExitTask = WatchExitAsync(session);
            return new TerminalSessionStart(id);
        }
        catch
        {
            _activeContainers.Remove(containerName);
            KillProcess(process);
            process.Dispose();
            _sessionSlots.Release();
            throw;
        }
    }

    public async Task WriteInputAsync(string id, string input, CancellationToken cancellationToken)
    {
        var session = Find(id);
        if (string.IsNullOrEmpty(input) || input.Length > MaxInputCharacters)
            throw new ArgumentException("Terminal input must contain 1 to 4096 characters.", nameof(input));
        await session.InputLock.WaitAsync(cancellationToken);
        try
        {
            if (session.Process.HasExited) throw new InvalidOperationException("This terminal session has ended.");
            await session.Process.StandardInput.WriteAsync(input.AsMemory(), cancellationToken);
            await session.Process.StandardInput.FlushAsync(cancellationToken);
            session.LastActivity = DateTimeOffset.UtcNow;
        }
        catch (IOException) { throw new InvalidOperationException("This terminal session has ended."); }
        finally { session.InputLock.Release(); }
    }

    public async Task<TerminalSessionOutput> ReadOutputAsync(string id, int offset, CancellationToken cancellationToken)
    {
        if (offset < 0) throw new ArgumentOutOfRangeException(nameof(offset));
        var session = Find(id);
        await session.OutputLock.WaitAsync(cancellationToken);
        try
        {
            var nextOffset = session.Output.Length;
            var start = Math.Min(offset, nextOffset);
            session.LastActivity = DateTimeOffset.UtcNow;
            return new TerminalSessionOutput(session.Output.ToString(start, nextOffset - start), nextOffset,
                session.ExitedAt is not null, session.ExitCode);
        }
        finally { session.OutputLock.Release(); }
    }

    public async Task CloseAsync(string id)
    {
        if (_sessions.TryRemove(id, out var session)) await DisposeSessionAsync(session);
    }

    private Session Find(string id) =>
        id.Length == 32 && id.All(Uri.IsHexDigit) && _sessions.TryGetValue(id, out var session)
            ? session
            : throw new KeyNotFoundException("Terminal session not found.");

    private static string[] BuildArguments(string containerName) =>
    [
        "run", "--rm", "--interactive", "--name", containerName,
        "--label", "syncode.terminal=true",
        "--pull=never", "--network=none", "--memory=256m", "--memory-swap=256m",
        "--cpus=0.5", "--pids-limit=32", "--read-only",
        "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=16m,uid=10001,gid=10001",
        "--tmpfs", "/workspace:rw,exec,nosuid,nodev,size=64m,uid=10001,gid=10001",
        "--cap-drop=ALL", "--security-opt=no-new-privileges", "--user=10001:10001",
        "--workdir=/workspace", "--env", "TERM=xterm-256color", "--env", "PS1=syncode:/workspace$ ",
        "--entrypoint", "/usr/bin/script", "syncode-runner-bash",
        "-qfec", "exec /bin/bash --noprofile --norc -i", "/dev/null"
    ];

    private async Task PumpAsync(Session session, StreamReader reader, CancellationToken cancellationToken)
    {
        var buffer = new char[2048];
        while (!cancellationToken.IsCancellationRequested)
        {
            var count = await reader.ReadAsync(buffer.AsMemory(), cancellationToken);
            if (count == 0) return;
            await session.OutputLock.WaitAsync(cancellationToken);
            try
            {
                var remaining = MaxOutputCharacters - session.Output.Length;
                if (remaining > 0) session.Output.Append(buffer, 0, Math.Min(count, remaining));
                if (count > remaining) session.OutputLimitReached = true;
                session.LastActivity = DateTimeOffset.UtcNow;
            }
            finally { session.OutputLock.Release(); }
            if (session.OutputLimitReached)
            {
                KillProcess(session.Process);
                await KillContainerAsync(session.ContainerName);
                return;
            }
        }
    }

    private async Task WatchExitAsync(Session session)
    {
        try { await session.Process.WaitForExitAsync(_shutdown.Token); }
        catch (OperationCanceledException) { }
        if (!session.Process.HasExited) return;
        session.ExitCode = session.Process.ExitCode;
        var now = DateTimeOffset.UtcNow;
        session.ExitedAt = now;
        session.LastActivity = now;
        _activeContainers.Remove(session.ContainerName);
        ReleaseSlot(session);
        try { if (session.OutputTask is not null) await session.OutputTask; }
        catch (Exception exception) when (exception is IOException or ObjectDisposedException or OperationCanceledException)
        { _logger.LogDebug(exception, "Terminal output stream closed for {SessionId}", session.Id); }
    }

    private async Task CleanupLoopAsync(CancellationToken cancellationToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(30));
        try
        {
            while (await timer.WaitForNextTickAsync(cancellationToken))
                foreach (var session in _sessions.Values)
                    if ((session.ExitedAt is { } exitedAt && DateTimeOffset.UtcNow - exitedAt > TimeSpan.FromMinutes(2)) ||
                        DateTimeOffset.UtcNow - session.LastActivity > IdleLifetime ||
                        DateTimeOffset.UtcNow - session.CreatedAt > MaximumLifetime)
                        await CloseAsync(session.Id);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { }
    }

    private async Task DisposeSessionAsync(Session session)
    {
        try
        {
            try { await session.Process.StandardInput.DisposeAsync(); } catch (Exception exception) when (exception is IOException or InvalidOperationException or ObjectDisposedException) { }
            try { await session.Process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(2)); }
            catch (TimeoutException) { KillProcess(session.Process); await KillContainerAsync(session.ContainerName); }
            catch (InvalidOperationException) { }
            try { if (session.OutputTask is not null) await session.OutputTask.WaitAsync(TimeSpan.FromSeconds(1)); }
            catch (Exception exception) when (exception is IOException or ObjectDisposedException or OperationCanceledException or TimeoutException)
            { KillProcess(session.Process); }
            try { if (session.ExitTask is not null) await session.ExitTask.WaitAsync(TimeSpan.FromSeconds(2)); }
            catch (Exception exception) when (exception is InvalidOperationException or ObjectDisposedException or OperationCanceledException or TimeoutException)
            { _logger.LogDebug(exception, "Terminal process watcher did not finish for {SessionId}", session.Id); }
            session.Process.Dispose();
        }
        finally
        {
            _activeContainers.Remove(session.ContainerName);
            ReleaseSlot(session);
        }
    }

    private void ReleaseSlot(Session session)
    {
        if (Interlocked.Exchange(ref session.SlotReleased, 1) == 0) _sessionSlots.Release();
    }

    private async Task KillContainerAsync(string name)
    {
        try
        {
            using var process = new Process { StartInfo = new ProcessStartInfo
            {
                FileName = _docker, UseShellExecute = false, RedirectStandardOutput = true,
                RedirectStandardError = true, CreateNoWindow = true
            }};
            process.StartInfo.ArgumentList.Add("rm");
            process.StartInfo.ArgumentList.Add("-f");
            process.StartInfo.ArgumentList.Add(name);
            if (process.Start()) await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(3));
        }
        catch (Exception exception) when (exception is IOException or InvalidOperationException or TimeoutException or System.ComponentModel.Win32Exception)
        { _logger.LogDebug(exception, "Could not immediately remove terminal container {ContainerName}", name); }
    }

    private static void KillProcess(Process process)
    {
        try { if (!process.HasExited) process.Kill(entireProcessTree: true); }
        catch (InvalidOperationException) { }
        catch (System.ComponentModel.Win32Exception) { }
    }

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        _shutdown.Cancel();
        foreach (var session in _sessions.Values) await CloseAsync(session.Id);
        if (_cleanupTask is not null) await _cleanupTask.WaitAsync(cancellationToken);
    }

    public async ValueTask DisposeAsync()
    {
        await StopAsync(CancellationToken.None);
        _shutdown.Dispose();
        _sessionSlots.Dispose();
    }

    private sealed class Session(string id, string containerName, Process process)
    {
        public string Id { get; } = id;
        public string ContainerName { get; } = containerName;
        public Process Process { get; } = process;
        public StringBuilder Output { get; } = new();
        public SemaphoreSlim InputLock { get; } = new(1, 1);
        public SemaphoreSlim OutputLock { get; } = new(1, 1);
        public DateTimeOffset CreatedAt { get; } = DateTimeOffset.UtcNow;
        public DateTimeOffset LastActivity { get; set; } = DateTimeOffset.UtcNow;
        public bool OutputLimitReached { get; set; }
        public DateTimeOffset? ExitedAt { get; set; }
        public int? ExitCode { get; set; }
        public int SlotReleased;
        public Task? OutputTask { get; set; }
        public Task? ExitTask { get; set; }
    }
}
