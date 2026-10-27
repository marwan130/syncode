using System.Collections.Concurrent;
using System.Diagnostics;
using System.Globalization;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Syncode.ExecutionService.Security;

namespace Syncode.ExecutionService.Runner;

public sealed record LanguageServerStart(string SessionId);

public sealed class LanguageServerSessions : IHostedService, IAsyncDisposable
{
    private const int MaximumEntries = 500;
    private const int MaximumFileBytes = 16 * 1024 * 1024;
    private const long MaximumWorkspaceBytes = 32L * 1024 * 1024;
    private const int MaximumMessageBytes = 4 * 1024 * 1024;
    private static readonly TimeSpan MaximumSessionDuration = TimeSpan.FromMinutes(30);
    private static readonly Regex ValidRoomId = new("^[a-zA-Z0-9_-]{1,128}$", RegexOptions.Compiled | RegexOptions.CultureInvariant);
    private readonly ConcurrentDictionary<string, Session> _sessions = new(StringComparer.Ordinal);
    private readonly SemaphoreSlim _slots;
    private readonly RoomDependencyStore _dependencies;
    private readonly ILogger<LanguageServerSessions> _logger;
    private readonly string _runtime;
    private readonly string _docker;
    private readonly CancellationTokenSource _shutdown = new();

    public LanguageServerSessions(
        RoomDependencyStore dependencies,
        ILogger<LanguageServerSessions> logger,
        IConfiguration configuration,
        string runtime)
    {
        _dependencies = dependencies;
        _logger = logger;
        _runtime = runtime;
        _docker = configuration["ExecutionService:DockerCli"] ?? "docker";
        var maximumSessions = configuration.GetValue("ExecutionService:MaxLanguageServerSessions", 8);
        if (maximumSessions is < 1 or > 256)
            throw new InvalidOperationException("ExecutionService:MaxLanguageServerSessions must be between 1 and 256.");
        _slots = new SemaphoreSlim(maximumSessions, maximumSessions);
    }

    private Task? _cleanupTask;

    public Task StartAsync(CancellationToken cancellationToken)
    {
        _cleanupTask = CleanupExpiredSessionsAsync(_shutdown.Token);
        return Task.CompletedTask;
    }

    public async Task<LanguageServerStart> CreateAsync(
        string roomId,
        string language,
        IReadOnlyList<TerminalWorkspaceEntry> entries,
        CancellationToken cancellationToken)
    {
        if (!ValidRoomId.IsMatch(roomId) || !TryResolveServer(language, out var server))
            throw new ArgumentException("Invalid language server request.");
        if (!await _slots.WaitAsync(0, cancellationToken))
            throw new LanguageServerCapacityException();

        var id = Guid.NewGuid().ToString("N");
        var containerName = $"syncode-lsp-{id}";
        var workspace = Path.Combine(Path.GetTempPath(), containerName);
        Process? process = null;
        try
        {
            await MaterializeWorkspaceAsync(workspace, entries, cancellationToken);
            process = StartContainer(containerName, server, workspace, _dependencies.GetRoomPath(roomId));
            var session = new Session(id, containerName, workspace, process, DateTimeOffset.UtcNow);
            if (!_sessions.TryAdd(id, session)) throw new InvalidOperationException("Could not create language server session.");
            process = null;
            return new LanguageServerStart(id);
        }
        catch
        {
            if (process is not null) KillProcess(process);
            TryDeleteWorkspace(workspace);
            _slots.Release();
            throw;
        }
    }

    public async Task ProxyAsync(string sessionId, WebSocket socket, CancellationToken cancellationToken)
    {
        if (!_sessions.TryGetValue(sessionId, out var session) || !session.TryConnect())
            throw new KeyNotFoundException("Language server session not found.");

        using var duration = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, _shutdown.Token);
        duration.CancelAfter(MaximumSessionDuration);
        try
        {
            var stderrTask = DrainErrorAsync(session.Process.StandardError, duration.Token);
            var clientToServer = CopyWebSocketToProcessAsync(socket, session.Process.StandardInput.BaseStream, duration.Token);
            var serverToClient = CopyProcessToWebSocketAsync(session.Process.StandardOutput.BaseStream, socket, duration.Token);
            await Task.WhenAny(clientToServer, serverToClient);
            duration.Cancel();
            await IgnoreExpectedStopAsync(Task.WhenAll(clientToServer, serverToClient, stderrTask));
        }
        finally
        {
            await CloseAsync(sessionId);
            if (socket.State is WebSocketState.Open or WebSocketState.CloseReceived)
            {
                try { await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "Language server closed", CancellationToken.None); }
                catch (WebSocketException) { }
            }
        }
    }

    public async Task CloseAsync(string sessionId)
    {
        if (!_sessions.TryRemove(sessionId, out var session)) return;
        KillProcess(session.Process);
        await WaitForExitAsync(session.Process);
        await RemoveContainerAsync(session.ContainerName);
        TryDeleteWorkspace(session.WorkspaceDirectory);
        session.Dispose();
        _slots.Release();
    }

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        _shutdown.Cancel();
        foreach (var id in _sessions.Keys) await CloseAsync(id);
        if (_cleanupTask is not null)
        {
            try { await _cleanupTask.WaitAsync(cancellationToken); }
            catch (OperationCanceledException) { }
        }
    }

    public async ValueTask DisposeAsync()
    {
        await StopAsync(CancellationToken.None);
        _shutdown.Dispose();
        _slots.Dispose();
    }

    private Process StartContainer(string containerName, LanguageServer server, string workspace, string dependencies)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = _docker,
            UseShellExecute = false,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };
        foreach (var argument in BuildArguments(containerName, server, workspace, dependencies))
            startInfo.ArgumentList.Add(argument);

        var process = new Process { StartInfo = startInfo, EnableRaisingEvents = true };
        if (!process.Start()) throw new InvalidOperationException("Could not start the language server container.");
        return process;
    }

    private IReadOnlyList<string> BuildArguments(string name, LanguageServer server, string workspace, string dependencies)
    {
        var args = new List<string>
        {
            "run", "--name", name, "--interactive", "--pull=never",
            ContainerRuntimePolicy.DockerArgument(_runtime),
            "--label", "syncode.execution=true",
            "--label", "syncode.language-server=true",
            "--network=none", "--memory=1g", "--memory-swap=1g", "--cpus=1",
            "--pids-limit=128", "--ulimit", "nofile=512:512", "--read-only",
            "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=256m,uid=10001,gid=10001",
            "--tmpfs", "/runner:rw,exec,nosuid,nodev,size=256m,uid=10001,gid=10001",
            "--cap-drop=ALL", "--security-opt=no-new-privileges", "--user", "10001:10001",
            "--env", "HOME=/tmp", "--env", "TMPDIR=/tmp", "--env", "DOTNET_CLI_HOME=/tmp/dotnet",
            "--env", "DOTNET_PROCESSOR_COUNT=1", "--env", "NUGET_PACKAGES=/deps/nuget",
            "--env", "CARGO_HOME=/deps/cargo-home", "--env", "RUSTUP_HOME=/usr/local/rustup",
            "--env", "GRADLE_USER_HOME=/deps/gradle", "--env", "MAVEN_OPTS=-Dmaven.repo.local=/deps/maven",
            "--env", "NODE_PATH=/deps/npm-global/lib/node_modules", "--env", "PYTHONPATH=/deps/python",
            "--mount", Mount(workspace, "/workspace", readOnly: true),
            "--mount", Mount(dependencies, "/deps", readOnly: true),
            "--mount", Mount(Path.Combine(dependencies, "npm-project", "node_modules"), "/workspace/node_modules", readOnly: true),
            "--workdir", "/workspace", "--entrypoint", server.Command[0], server.Image,
        };
        args.AddRange(server.Command.Skip(1));
        return args;
    }

    private static async Task MaterializeWorkspaceAsync(
        string workspace,
        IReadOnlyList<TerminalWorkspaceEntry> entries,
        CancellationToken cancellationToken)
    {
        if (entries.Count > MaximumEntries) throw new ArgumentException("The room workspace contains too many entries.");
        Directory.CreateDirectory(workspace);
        long totalBytes = 0;
        var paths = new HashSet<string>(StringComparer.Ordinal);
        foreach (var entry in entries)
        {
            if (entry is null || !IsSafePath(entry.Path) || entry.Content is null ||
                entry.IsFolder && entry.Content.Length != 0 || !paths.Add(entry.Path))
                throw new ArgumentException("The room workspace contains an invalid entry.");

            var target = Path.GetFullPath(Path.Combine(workspace, entry.Path.Replace('/', Path.DirectorySeparatorChar)));
            if (!target.StartsWith(Path.GetFullPath(workspace) + Path.DirectorySeparatorChar, StringComparison.Ordinal))
                throw new ArgumentException("The room workspace contains an invalid path.");
            if (entry.IsFolder)
            {
                Directory.CreateDirectory(target);
                continue;
            }

            var bytes = Encoding.UTF8.GetByteCount(entry.Content);
            if (bytes > MaximumFileBytes || totalBytes > MaximumWorkspaceBytes - bytes)
                throw new ArgumentException("The room workspace exceeds the language server size limit.");
            totalBytes += bytes;
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            await File.WriteAllTextAsync(target, entry.Content, new UTF8Encoding(false), cancellationToken);
        }
    }

    private static bool IsSafePath(string path) =>
        !string.IsNullOrWhiteSpace(path) && path.Length <= 512 && !path.StartsWith('/') &&
        !path.Contains('\\') && !path.Any(char.IsControl) &&
        path.Split('/').All(segment => segment.Length > 0 && segment is not "." and not ".." &&
            segment.IndexOfAny([':', '*', '?', '"', '<', '>', '|']) < 0);

    private static async Task CopyWebSocketToProcessAsync(WebSocket socket, Stream input, CancellationToken cancellationToken)
    {
        var buffer = new byte[16 * 1024];
        using var message = new MemoryStream();
        while (!cancellationToken.IsCancellationRequested)
        {
            var result = await socket.ReceiveAsync(buffer, cancellationToken);
            if (result.MessageType == WebSocketMessageType.Close) return;
            if (result.MessageType != WebSocketMessageType.Text || message.Length + result.Count > MaximumMessageBytes)
                throw new WebSocketException("Invalid language server message.");
            message.Write(buffer, 0, result.Count);
            if (!result.EndOfMessage) continue;

            var body = message.ToArray();
            using (JsonDocument.Parse(body)) { }
            var header = Encoding.ASCII.GetBytes($"Content-Length: {body.Length}\r\n\r\n");
            await input.WriteAsync(header, cancellationToken);
            await input.WriteAsync(body, cancellationToken);
            await input.FlushAsync(cancellationToken);
            message.SetLength(0);
        }
    }

    private static async Task CopyProcessToWebSocketAsync(Stream output, WebSocket socket, CancellationToken cancellationToken)
    {
        var buffered = new BufferedStream(output, 16 * 1024);
        while (!cancellationToken.IsCancellationRequested)
        {
            var header = new StringBuilder();
            while (true)
            {
                var value = buffered.ReadByte();
                if (value < 0) return;
                header.Append((char)value);
                if (header.Length > 1024) throw new InvalidDataException("Invalid language server frame.");
                if (header.ToString().EndsWith("\r\n\r\n", StringComparison.Ordinal)) break;
            }
            var length = ParseContentLength(header.ToString());
            if (length is < 0 or > MaximumMessageBytes) throw new InvalidDataException("Invalid language server frame.");
            var body = new byte[length];
            await buffered.ReadExactlyAsync(body, cancellationToken);
            await socket.SendAsync(body, WebSocketMessageType.Text, true, cancellationToken);
        }
    }

    private static int ParseContentLength(string header)
    {
        foreach (var line in header.Split("\r\n", StringSplitOptions.RemoveEmptyEntries))
        {
            var separator = line.IndexOf(':');
            if (separator > 0 && line[..separator].Equals("Content-Length", StringComparison.OrdinalIgnoreCase) &&
                int.TryParse(line[(separator + 1)..].Trim(), NumberStyles.None, CultureInfo.InvariantCulture, out var length))
                return length;
        }
        throw new InvalidDataException("Language server frame has no content length.");
    }

    private static async Task DrainErrorAsync(StreamReader error, CancellationToken cancellationToken)
    {
        var buffer = new char[2048];
        while (await error.ReadAsync(buffer.AsMemory(), cancellationToken) is > 0) { }
    }

    private async Task CleanupExpiredSessionsAsync(CancellationToken cancellationToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(1));
        while (await timer.WaitForNextTickAsync(cancellationToken))
        {
            var staleIds = _sessions.Values
                .Where(session => DateTimeOffset.UtcNow - session.CreatedAt > MaximumSessionDuration)
                .Select(session => session.Id)
                .ToArray();
            foreach (var id in staleIds) await CloseAsync(id);
        }
    }

    private static async Task IgnoreExpectedStopAsync(Task task)
    {
        try { await task; }
        catch (Exception exception) when (exception is OperationCanceledException or IOException or WebSocketException or InvalidOperationException) { }
    }

    private static bool TryResolveServer(string language, out LanguageServer server)
    {
        server = language.Trim().ToLowerInvariant() switch
        {
            "html" => new("syncode-runner-node", ["vscode-html-language-server", "--stdio"]),
            "css" => new("syncode-runner-node", ["vscode-css-language-server", "--stdio"]),
            "python" => new("syncode-runner-node", ["pyright-langserver", "--stdio"]),
            "c" or "cpp" => new("syncode-runner-cpp", ["clangd", "--background-index=0", "--log=error"]),
            "csharp" => new("syncode-runner-dotnet", ["csharp-ls"]),
            "rust" => new("syncode-runner-rust", ["rust-analyzer"]),
            "java" => new("syncode-runner-java", ["jdtls", "-data", "/tmp/jdtls-data"]),
            _ => null!,
        };
        return server is not null;
    }

    private static string Mount(string source, string target, bool readOnly) =>
        $"type=bind,source={source},target={target}{(readOnly ? ",readonly" : string.Empty)}";

    private async Task RemoveContainerAsync(string name)
    {
        try
        {
            using var process = new Process();
            process.StartInfo = new ProcessStartInfo
            {
                FileName = _docker,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            };
            process.StartInfo.ArgumentList.Add("rm");
            process.StartInfo.ArgumentList.Add("-f");
            process.StartInfo.ArgumentList.Add(name);
            if (process.Start()) await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(3));
        }
        catch (Exception exception) when (exception is IOException or InvalidOperationException or TimeoutException or System.ComponentModel.Win32Exception) { }
    }

    private static void KillProcess(Process process)
    {
        try { if (!process.HasExited) process.Kill(entireProcessTree: true); }
        catch (InvalidOperationException) { }
        catch (System.ComponentModel.Win32Exception) { }
    }

    private static async Task WaitForExitAsync(Process process)
    {
        try { await process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(3)); }
        catch (Exception exception) when (exception is InvalidOperationException or TimeoutException) { }
    }

    private static void TryDeleteWorkspace(string workspace)
    {
        try { if (Directory.Exists(workspace)) Directory.Delete(workspace, recursive: true); }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException) { }
    }

    private sealed record LanguageServer(string Image, IReadOnlyList<string> Command);

    private sealed class Session(string id, string containerName, string workspaceDirectory, Process process, DateTimeOffset createdAt) : IDisposable
    {
        private int _connected;
        internal string Id { get; } = id;
        internal string ContainerName { get; } = containerName;
        internal string WorkspaceDirectory { get; } = workspaceDirectory;
        internal Process Process { get; } = process;
        internal DateTimeOffset CreatedAt { get; } = createdAt;
        internal bool TryConnect() => Interlocked.CompareExchange(ref _connected, 1, 0) == 0;
        public void Dispose() => Process.Dispose();
    }
}

public sealed class LanguageServerCapacityException : Exception
{
    public LanguageServerCapacityException() : base("Language server capacity is full.") { }
    public LanguageServerCapacityException(string message) : base(message) { }
    public LanguageServerCapacityException(string message, Exception innerException) : base(message, innerException) { }
}
