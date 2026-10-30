using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text;
using System.Text.Json;
using Syncode.ExecutionService.Security;

namespace Syncode.ExecutionService.Runner;

public sealed record TerminalSessionStart(string SessionId);
public sealed record TerminalSessionOutput(
    string Text,
    int Offset,
    bool Exited,
    int? ExitCode,
    IReadOnlyList<TerminalWorkspaceEntry> ChangedEntries,
    IReadOnlyList<TerminalWorkspaceEntry> DeletedEntries,
    IReadOnlyList<string> UnsupportedPaths);
public sealed class TerminalSessionLimitException(string message) : Exception(message);

public sealed class InteractiveTerminalSessions : IHostedService, IAsyncDisposable
{
    private const int MaxSessions = 8;
    private const int MaxOutputCharacters = 256 * 1024;
    private const int MaxInputCharacters = 4096;
    private static readonly TimeSpan IdleLifetime = TimeSpan.FromMinutes(15);
    private static readonly TimeSpan MaximumLifetime = TimeSpan.FromHours(1);
    private const long MaximumWorkspaceDiskBytes = 128L * 1024 * 1024;
    private readonly ConcurrentDictionary<string, Session> _sessions = new(StringComparer.Ordinal);
    private readonly string _docker;
    private readonly string _containerRuntime;
    private readonly ILogger<InteractiveTerminalSessions> _logger;
    private readonly ActiveContainerRegistry _activeContainers;
    private readonly PackageEgressBoundary _packageEgress;
    private readonly RoomDependencyStore _dependencies;
    private readonly SemaphoreSlim _sessionSlots = new(MaxSessions, MaxSessions);
    private readonly CancellationTokenSource _shutdown = new();
    private Task? _cleanupTask;

    public InteractiveTerminalSessions(
        IConfiguration configuration,
        ILogger<InteractiveTerminalSessions> logger,
        ActiveContainerRegistry activeContainers,
        PackageEgressBoundary packageEgress,
        RoomDependencyStore dependencies)
    {
        _docker = configuration["ExecutionService:DockerCli"] ?? "docker";
        _containerRuntime = configuration["ExecutionService:ContainerRuntime"] ?? "runc";
        _logger = logger;
        _activeContainers = activeContainers;
        _packageEgress = packageEgress;
        _dependencies = dependencies;
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        _cleanupTask = CleanupLoopAsync(_shutdown.Token);
        return Task.CompletedTask;
    }

    public async Task<TerminalSessionStart> CreateAsync(
        string roomId,
        IReadOnlyList<TerminalWorkspaceEntry> entries,
        CancellationToken cancellationToken)
    {
        if (!await _sessionSlots.WaitAsync(0, cancellationToken))
            throw new TerminalSessionLimitException("The terminal session limit has been reached. Close an unused terminal and try again.");

        var id = Guid.NewGuid().ToString("N");
        var containerName = $"syncode-terminal-{id}";
        var workspaceDirectory = Path.Combine(Path.GetTempPath(), $"{containerName}-workspace");
        var dependencyDirectory = _dependencies.GetRoomPath(roomId);
        var startInfo = new ProcessStartInfo
        {
            FileName = _docker,
            UseShellExecute = false,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };
        WorkspaceMaterialization initialWorkspace;
        RunnerNetwork? runnerNetwork = null;
        try
        {
            initialWorkspace = await InitializeWorkspaceAsync(workspaceDirectory, entries, cancellationToken);
            runnerNetwork = await _packageEgress.CreateSessionNetworkAsync(id, cancellationToken);
        }
        catch
        {
            _sessionSlots.Release();
            TryDeleteWorkspace(workspaceDirectory);
            throw;
        }
        foreach (var argument in BuildArguments(containerName, workspaceDirectory, dependencyDirectory, runnerNetwork)) startInfo.ArgumentList.Add(argument);

        var process = new Process { StartInfo = startInfo, EnableRaisingEvents = true };
        _activeContainers.Add(containerName);
        try
        {
            if (!process.Start()) throw new InvalidOperationException("Could not start the isolated Bash terminal.");
            var session = new Session(id, roomId, containerName, process, workspaceDirectory, initialWorkspace, runnerNetwork);
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
            await KillContainerAsync(containerName);
            process.Dispose();
            await _packageEgress.RemoveSessionNetworkAsync(runnerNetwork);
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

    public async Task RunFileAsync(
        string id,
        string language,
        string sourcePath,
        IReadOnlyList<TerminalWorkspaceEntry> entries,
        CancellationToken cancellationToken)
    {
        var session = Find(id);
        var runtime = language.ToLowerInvariant() switch
        {
            "javascript" => "node",
            "typescript" => "typescript",
            "python" => "python",
            "csharp" or "c#" => "csharp",
            "c" => "c",
            "cpp" or "c++" => "cpp",
            "rust" => "rust",
            "java" => "java",
            _ => throw new ArgumentException("The selected file type cannot be run.", nameof(language))
        };
        if (!WorkspaceLimits.IsSharedPath(sourcePath) ||
            entries.Count is < 1 or > WorkspaceLimits.MaximumEntries ||
            !entries.Any(entry => entry.Path == sourcePath && !entry.IsFolder))
            throw new ArgumentException("The active project file is invalid.", nameof(sourcePath));

        await SyncWorkspaceAsync(session, entries, cancellationToken);
        var command = $"/usr/local/bin/syncode-runner {QuoteShellValue(runtime)} {QuoteShellValue(sourcePath)}\n";
        await session.InputLock.WaitAsync(cancellationToken);
        try
        {
            if (session.Process.HasExited) throw new InvalidOperationException("This terminal session has ended.");
            await session.Process.StandardInput.WriteAsync("\u0003".AsMemory(), cancellationToken);
            await session.Process.StandardInput.FlushAsync(cancellationToken);
            await Task.Delay(TimeSpan.FromMilliseconds(100), cancellationToken);
            if (session.Process.HasExited) throw new InvalidOperationException("This terminal session has ended.");
            await session.Process.StandardInput.WriteAsync(command.AsMemory(), cancellationToken);
            await session.Process.StandardInput.FlushAsync(cancellationToken);
            session.LastActivity = DateTimeOffset.UtcNow;
        }
        catch (IOException) { throw new InvalidOperationException("This terminal session has ended."); }
        finally { session.InputLock.Release(); }
    }

    public async Task<TerminalSessionOutput> ReadOutputAsync(string id, int offset, CancellationToken cancellationToken)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(offset);
        var session = Find(id);
        await session.OutputLock.WaitAsync(cancellationToken);
        try
        {
            var nextOffset = session.Output.Length;
            var start = Math.Min(offset, nextOffset);
            session.LastActivity = DateTimeOffset.UtcNow;
            var workspaceChanges = await ReadWorkspaceChangesAsync(session, cancellationToken);
            return new TerminalSessionOutput(session.Output.ToString(start, nextOffset - start), nextOffset,
                session.ExitedAt is not null, session.ExitCode,
                workspaceChanges.Entries, workspaceChanges.DeletedEntries, workspaceChanges.UnsupportedPaths);
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

    private string[] BuildArguments(string containerName, string workspaceDirectory, string dependencyDirectory, RunnerNetwork? network)
    {
        var arguments = new List<string>
        {
        "run", "--rm", "--interactive", "--name", containerName,
        "--label", "syncode.terminal=true",
        "--pull=never", ContainerRuntimePolicy.DockerArgument(_containerRuntime), "--network=none", "--memory=512m", "--memory-swap=512m",
        "--cpus=0.5", "--pids-limit=64", "--read-only",
        "--ulimit", "nofile=256:256", "--ulimit", "fsize=268435456:268435456",
        "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=64m,uid=10001,gid=10001",
        "--tmpfs", "/runner:rw,exec,nosuid,nodev,size=256m,uid=10001,gid=10001",
        "--mount", $"type=bind,source={workspaceDirectory},target=/workspace",
        "--mount", $"type=bind,source={dependencyDirectory},target=/deps",
        "--mount", $"type=bind,source={Path.Combine(dependencyDirectory, "npm-project", "node_modules")},target=/workspace/node_modules",
        "--cap-drop=ALL", "--security-opt=no-new-privileges", "--user=10001:10001",
        "--workdir=/workspace", "--env", "TERM=xterm-256color", "--env", "PS1=syncode:/workspace$ ",
        "--env", "HOME=/deps/home", "--env", "XDG_CACHE_HOME=/deps/cache", "--env", "DOTNET_CLI_HOME=/deps/dotnet",
        "--env", "DOTNET_PROCESSOR_COUNT=1",
        "--env", "NPM_CONFIG_CACHE=/deps/npm-cache", "--env", "NPM_CONFIG_PREFIX=/deps/npm-global",
        "--env", "YARN_CACHE_FOLDER=/deps/yarn-cache",
        "--env", "NODE_PATH=/deps/npm-global/lib/node_modules",
        "--env", "PIP_CACHE_DIR=/deps/pip-cache", "--env", "PIP_TARGET=/deps/python",
        "--env", "PYTHONPATH=/deps/python", "--env", "NUGET_PACKAGES=/deps/nuget",
        "--env", "CARGO_HOME=/deps/cargo-home", "--env", "RUSTUP_HOME=/usr/local/rustup",
        "--env", "GRADLE_USER_HOME=/deps/gradle", "--env", "MAVEN_OPTS=-Dmaven.repo.local=/deps/maven",
        "--env", "CONAN_HOME=/deps/conan",
        "--entrypoint", "/usr/bin/script", "syncode-runner-bash",
        "-qfec", "exec /bin/bash --noprofile --norc -i", "/dev/null"
        };
        if (network is null)
            return arguments.ToArray();

        var networkOption = arguments.IndexOf("--network=none");
        arguments[networkOption] = "--network";
        arguments.Insert(networkOption + 1, network.Name);

        arguments.InsertRange(networkOption + 2,
        [
            "--dns", network.ProxyAddress,
            "--env", $"HTTP_PROXY=http://{network.ProxyAddress}:3128",
            "--env", $"HTTPS_PROXY=http://{network.ProxyAddress}:3128",
            "--env", $"http_proxy=http://{network.ProxyAddress}:3128",
            "--env", $"https_proxy=http://{network.ProxyAddress}:3128",
            "--env", "NO_PROXY=localhost,127.0.0.1,::1",
            "--env", "no_proxy=localhost,127.0.0.1,::1"
        ]);
        return arguments.ToArray();
    }

    private static async Task<WorkspaceMaterialization> InitializeWorkspaceAsync(
        string workspaceDirectory,
        IReadOnlyList<TerminalWorkspaceEntry> entries,
        CancellationToken cancellationToken)
    {
        if (entries.Count > WorkspaceLimits.MaximumEntries)
            throw new ArgumentException("The room workspace contains too many entries.", nameof(entries));
        Directory.CreateDirectory(workspaceDirectory);
        var snapshot = new Dictionary<string, TerminalWorkspaceEntry>(StringComparer.Ordinal);
        var fileStates = new Dictionary<string, WorkspaceFileState>(StringComparer.Ordinal);
        long totalBytes = 0;
        foreach (var entry in entries)
        {
            var normalized = ValidateWorkspaceEntry(entry);
            if (!snapshot.TryAdd(normalized.Path, normalized))
                throw new ArgumentException("The room workspace contains duplicate paths.", nameof(entries));
            if (normalized.IsFolder)
            {
                Directory.CreateDirectory(ResolveWorkspacePath(workspaceDirectory, normalized.Path));
                continue;
            }
            var bytes = Encoding.UTF8.GetByteCount(normalized.Content);
            totalBytes += bytes;
            if (bytes > WorkspaceLimits.MaximumFileBytes || totalBytes > WorkspaceLimits.MaximumWorkspaceBytes)
                throw new ArgumentException("The room workspace exceeds the terminal size limit.", nameof(entries));
            var target = ResolveWorkspacePath(workspaceDirectory, normalized.Path);
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            await File.WriteAllTextAsync(target, normalized.Content, new UTF8Encoding(false), cancellationToken);
            fileStates.Add(normalized.Path, WorkspaceFileState.From(new FileInfo(target)));
        }
        return new WorkspaceMaterialization(snapshot, fileStates);
    }

    private async Task<TerminalWorkspaceChanges> ReadWorkspaceChangesAsync(
        Session session,
        CancellationToken cancellationToken)
    {
        await session.WorkspaceLock.WaitAsync(cancellationToken);
        try
        {
            var current = new Dictionary<string, TerminalWorkspaceEntry>(StringComparer.Ordinal);
            var currentFileStates = new Dictionary<string, WorkspaceFileState>(StringComparer.Ordinal);
            var unsupported = new HashSet<string>(StringComparer.Ordinal);
            long totalBytes = 0;
            try
            {
                ScanWorkspaceDirectory(session.WorkspaceDirectory, string.Empty, current, currentFileStates,
                    session, unsupported, ref totalBytes);
            }
            catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
            {
                return new TerminalWorkspaceChanges([], [], ["."]);
            }
            if (current.Count > WorkspaceLimits.MaximumEntries)
                session.WorkspaceLimitExceeded = true;
            if (session.WorkspaceLimitExceeded)
            {
                unsupported.Add(".");
                if (!session.WorkspaceLimitMessageWritten)
                {
                    session.Output.Append("\r\nWorkspace quota exceeded. This terminal has been stopped.\r\n");
                    session.WorkspaceLimitMessageWritten = true;
                }
                KillProcess(session.Process);
                await KillContainerAsync(session.ContainerName);
                return new TerminalWorkspaceChanges([], [], ["."]);
            }

            var changed = current.Values
                .Where(entry => !session.WorkspaceEntries.TryGetValue(entry.Path, out var previous) || previous != entry)
                .Select(entry => entry with
                {
                    PreviousContent = session.WorkspaceEntries.TryGetValue(entry.Path, out var previous) && !previous.IsFolder
                        ? previous.Content
                        : null
                })
                .OrderBy(entry => entry.Path, StringComparer.Ordinal)
                .ToArray();
            var deleted = session.WorkspaceEntries
                .Where(pair =>
                    !current.ContainsKey(pair.Key) && !IsUnsupportedPath(pair.Key, unsupported))
                .Select(pair => pair.Value)
                .OrderByDescending(entry => entry.Path.Count(character => character == '/'))
                .ThenBy(entry => entry.Path, StringComparer.Ordinal)
                .ToArray();

            foreach (var entry in deleted) session.WorkspaceEntries.Remove(entry.Path);
            foreach (var entry in changed)
                session.WorkspaceEntries[entry.Path] = entry with { PreviousContent = null };
            session.WorkspaceFileStates.Clear();
            foreach (var (path, state) in currentFileStates) session.WorkspaceFileStates[path] = state;
            return new TerminalWorkspaceChanges(changed, deleted, unsupported.Order(StringComparer.Ordinal).ToArray());
        }
        finally
        {
            session.WorkspaceLock.Release();
        }
    }

    private async Task SyncWorkspaceAsync(
        Session session,
        IReadOnlyList<TerminalWorkspaceEntry> entries,
        CancellationToken cancellationToken)
    {
        var snapshot = new Dictionary<string, TerminalWorkspaceEntry>(StringComparer.Ordinal);
        long totalBytes = 0;
        foreach (var entry in entries)
        {
            var normalized = ValidateWorkspaceEntry(entry);
            if (!snapshot.TryAdd(normalized.Path, normalized))
                throw new ArgumentException("The room workspace contains duplicate paths.", nameof(entries));
            if (!normalized.IsFolder)
            {
                var bytes = Encoding.UTF8.GetByteCount(normalized.Content);
                totalBytes += bytes;
                if (bytes > WorkspaceLimits.MaximumFileBytes || totalBytes > WorkspaceLimits.MaximumWorkspaceBytes)
                    throw new ArgumentException("The room workspace exceeds the terminal size limit.", nameof(entries));
            }
        }

        await session.WorkspaceLock.WaitAsync(cancellationToken);
        try
        {
            var payload = JsonSerializer.Serialize(
                new
                {
                    entries = snapshot.Values,
                    previousPaths = session.WorkspaceEntries.Keys
                },
                new JsonSerializerOptions(JsonSerializerDefaults.Web));
            var startInfo = new ProcessStartInfo
            {
                FileName = _docker,
                UseShellExecute = false,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            };
            foreach (var argument in new[]
                     {
                         "exec", "--interactive", "--user=10001:10001", session.ContainerName,
                         "python3", "/usr/local/bin/syncode-sync-workspace"
                     })
                startInfo.ArgumentList.Add(argument);
            using var process = new Process { StartInfo = startInfo };
            if (!process.Start()) throw new InvalidOperationException("Could not refresh the terminal workspace.");
            var outputTask = process.StandardOutput.ReadToEndAsync(cancellationToken);
            var errorTask = process.StandardError.ReadToEndAsync(cancellationToken);
            try
            {
                await process.StandardInput.WriteAsync(payload.AsMemory(), cancellationToken);
                await process.StandardInput.FlushAsync(cancellationToken);
                process.StandardInput.Close();
                await Task.WhenAll(process.WaitForExitAsync(cancellationToken), outputTask, errorTask);
                if (process.ExitCode != 0)
                    throw new InvalidOperationException("The room workspace could not be refreshed in the terminal.");
            }
            catch
            {
                KillProcess(process);
                throw;
            }

            var fileStates = new Dictionary<string, WorkspaceFileState>(StringComparer.Ordinal);
            foreach (var entry in snapshot.Values.Where(entry => !entry.IsFolder))
            {
                var target = ResolveWorkspacePath(session.WorkspaceDirectory, entry.Path);
                fileStates.Add(entry.Path, WorkspaceFileState.From(new FileInfo(target)));
            }

            session.WorkspaceEntries.Clear();
            foreach (var entry in snapshot) session.WorkspaceEntries.Add(entry.Key, entry.Value);
            session.WorkspaceFileStates.Clear();
            foreach (var file in fileStates) session.WorkspaceFileStates.Add(file.Key, file.Value);
        }
        finally { session.WorkspaceLock.Release(); }
    }

    private static string QuoteShellValue(string value) => $"'{value.Replace("'", "'\\''", StringComparison.Ordinal)}'";

    private static void ScanWorkspaceDirectory(
        string directory,
        string relativePath,
        Dictionary<string, TerminalWorkspaceEntry> entries,
        Dictionary<string, WorkspaceFileState> fileStates,
        Session session,
        HashSet<string> unsupported,
        ref long totalBytes)
    {
        foreach (var path in Directory.EnumerateFileSystemEntries(directory))
        {
            if (entries.Count + unsupported.Count >= WorkspaceLimits.MaximumEntries)
            {
                session.WorkspaceLimitExceeded = true;
                return;
            }
            var name = Path.GetFileName(path);
            var relative = relativePath.Length == 0 ? name : $"{relativePath}/{name}";
            if (!WorkspaceLimits.IsSharedPath(relative)) continue;
            try
            {
                var attributes = File.GetAttributes(path);
                if ((attributes & FileAttributes.ReparsePoint) != 0)
                {
                    unsupported.Add(relative);
                    continue;
                }
                if ((attributes & FileAttributes.Directory) != 0)
                {
                    entries.Add(relative, new TerminalWorkspaceEntry(relative, true, string.Empty));
                    ScanWorkspaceDirectory(path, relative, entries, fileStates, session, unsupported, ref totalBytes);
                    continue;
                }
                var fileInfo = new FileInfo(path);
                if (fileInfo.Length > WorkspaceLimits.MaximumFileBytes ||
                    totalBytes > WorkspaceLimits.MaximumWorkspaceBytes - fileInfo.Length)
                {
                    session.WorkspaceLimitExceeded = true;
                    return;
                }
                totalBytes += fileInfo.Length;
                var state = WorkspaceFileState.From(fileInfo);
                if (session.WorkspaceFileStates.TryGetValue(relative, out var previousState) && state == previousState &&
                    session.WorkspaceEntries.TryGetValue(relative, out var previousEntry))
                {
                    entries.Add(relative, previousEntry);
                    fileStates.Add(relative, state);
                    continue;
                }
                if (fileInfo.Length > WorkspaceLimits.MaximumFileBytes)
                {
                    unsupported.Add(relative);
                    continue;
                }
                var content = File.ReadAllText(path, new UTF8Encoding(false, true));
                if (Encoding.UTF8.GetByteCount(content) > WorkspaceLimits.MaximumFileBytes)
                {
                    unsupported.Add(relative);
                    continue;
                }
                entries.Add(relative, new TerminalWorkspaceEntry(relative, false, content));
                fileStates.Add(relative, state);
            }
            catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or DecoderFallbackException)
            {
                unsupported.Add(relative);
            }
        }
    }

    private static bool IsUnsupportedPath(string path, HashSet<string> unsupported) =>
        unsupported.Contains(path) || unsupported.Any(item => item == "." || path.StartsWith(item + "/", StringComparison.Ordinal));

    private static TerminalWorkspaceEntry ValidateWorkspaceEntry(TerminalWorkspaceEntry entry)
    {
        if (entry is null || !WorkspaceLimits.IsSharedPath(entry.Path) || entry.Content is null ||
            entry.IsFolder && entry.Content.Length != 0)
            throw new ArgumentException("The room workspace contains an invalid path or entry.", nameof(entry));
        return entry;
    }

    private static string ResolveWorkspacePath(string workspaceDirectory, string relativePath)
    {
        var root = Path.GetFullPath(workspaceDirectory) + Path.DirectorySeparatorChar;
        var target = Path.GetFullPath(Path.Combine(workspaceDirectory, relativePath.Replace('/', Path.DirectorySeparatorChar)));
        if (!target.StartsWith(root, StringComparison.Ordinal))
            throw new ArgumentException("The workspace path is outside its root.", nameof(relativePath));
        return target;
    }

    private static void TryDeleteWorkspace(string workspaceDirectory)
    {
        try
        {
            if (Directory.Exists(workspaceDirectory)) Directory.Delete(workspaceDirectory, recursive: true);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException) { }
    }

    private static class WorkspaceLimits
    {
        internal const int MaximumEntries = 500;
        internal const int MaximumFileBytes = 16 * 1024 * 1024;
        internal const long MaximumWorkspaceBytes = 32 * 1024 * 1024;
        private static readonly HashSet<string> GeneratedDirectories = new(StringComparer.OrdinalIgnoreCase)
        {
            ".git", ".next", ".nuxt", ".venv", "__pycache__", "bin", "build", "coverage",
            "dist", "node_modules", "obj", "out", "packages", "target", "vendor", "venv"
        };
        private static readonly HashSet<string> GeneratedExtensions = new(StringComparer.OrdinalIgnoreCase)
        {
            ".class", ".dll", ".exe", ".o", ".obj", ".pdb", ".pyc", ".so"
        };

        internal static bool IsSharedPath(string path) =>
            IsSafePath(path) && path.Split('/').All(segment => !GeneratedDirectories.Contains(segment)) &&
            !GeneratedExtensions.Contains(Path.GetExtension(path));

        private static bool IsSafePath(string path) =>
            !string.IsNullOrWhiteSpace(path) && path.Length <= 512 && !path.StartsWith('/') &&
            !path.Contains('\\') && !path.Any(char.IsControl) && path.Split('/').Length <= 32 &&
            path.Split('/').All(segment => segment.Length > 0 && segment is not "." and not ".." &&
                segment.IndexOfAny([':', '*', '?', '"', '<', '>', '|']) < 0);
    }

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
        {
            if (_logger.IsEnabled(LogLevel.Debug))
                _logger.LogDebug(exception, "Terminal output stream closed for {SessionId}", session.Id);
        }
    }

    private async Task CleanupLoopAsync(CancellationToken cancellationToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(2));
        try
        {
            while (await timer.WaitForNextTickAsync(cancellationToken))
                foreach (var session in _sessions.Values)
                {
                    if ((session.ExitedAt is { } exitedAt && DateTimeOffset.UtcNow - exitedAt > TimeSpan.FromMinutes(2)) ||
                        DateTimeOffset.UtcNow - session.LastActivity > IdleLifetime ||
                        DateTimeOffset.UtcNow - session.CreatedAt > MaximumLifetime)
                    {
                        await CloseAsync(session.Id);
                        continue;
                    }
                    await EnforceWorkspaceDiskLimitAsync(session, cancellationToken);
                    await EnforceDependencyDiskLimitAsync(session, cancellationToken);
                }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { }
    }

    private async Task EnforceWorkspaceDiskLimitAsync(Session session, CancellationToken cancellationToken)
    {
        var exceeded = false;
        await session.WorkspaceLock.WaitAsync(cancellationToken);
        try
        {
            if (session.WorkspaceLimitExceeded) return;
            var pending = new Stack<string>();
            pending.Push(session.WorkspaceDirectory);
            long bytes = 0;
            while (pending.TryPop(out var directory))
            {
                foreach (var path in Directory.EnumerateFileSystemEntries(directory))
                {
                    var attributes = File.GetAttributes(path);
                    if ((attributes & FileAttributes.ReparsePoint) != 0) continue;
                    if ((attributes & FileAttributes.Directory) != 0)
                    {
                        pending.Push(path);
                        continue;
                    }
                    bytes += new FileInfo(path).Length;
                    if (bytes > MaximumWorkspaceDiskBytes)
                    {
                        session.WorkspaceLimitExceeded = true;
                        exceeded = true;
                        break;
                    }
                }
                if (exceeded) break;
            }
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            session.WorkspaceLimitExceeded = true;
            exceeded = true;
        }
        finally { session.WorkspaceLock.Release(); }

        if (!exceeded) return;
        await session.OutputLock.WaitAsync(cancellationToken);
        try
        {
            session.Output.Append("\r\nTerminal workspace exceeded its 128 MB disk limit. This terminal has been stopped.\r\n");
            session.WorkspaceLimitMessageWritten = true;
        }
        finally { session.OutputLock.Release(); }
        KillProcess(session.Process);
        await KillContainerAsync(session.ContainerName);
    }

    private async Task EnforceDependencyDiskLimitAsync(Session session, CancellationToken cancellationToken)
    {
        bool exceeded;
        try { exceeded = _dependencies.ExceedsRoomLimit(session.RoomId); }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        { exceeded = true; }
        if (!exceeded) return;
        await session.OutputLock.WaitAsync(cancellationToken);
        try { session.Output.Append("\r\nRoom dependency storage exceeded its 256 MB limit. This terminal has been stopped.\r\n"); }
        finally { session.OutputLock.Release(); }
        KillProcess(session.Process);
        await KillContainerAsync(session.ContainerName);
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
            {
                if (_logger.IsEnabled(LogLevel.Debug))
                    _logger.LogDebug(exception, "Terminal process watcher did not finish for {SessionId}", session.Id);
            }
            session.Process.Dispose();
        }
        finally
        {
            _activeContainers.Remove(session.ContainerName);
            TryDeleteWorkspace(session.WorkspaceDirectory);
            await _packageEgress.RemoveSessionNetworkAsync(session.Network);
            ReleaseSlot(session);
        }
    }

    private void ReleaseSlot(Session session)
    {
        if (session.TryReleaseSlot()) _sessionSlots.Release();
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
        {
            if (_logger.IsEnabled(LogLevel.Debug))
                _logger.LogDebug(exception, "Could not immediately remove terminal container {ContainerName}", name);
        }
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

    private sealed record WorkspaceMaterialization(
        Dictionary<string, TerminalWorkspaceEntry> Entries,
        Dictionary<string, WorkspaceFileState> FileStates);

    private readonly record struct WorkspaceFileState(long Length, long LastWriteTimeTicks)
    {
        internal static WorkspaceFileState From(FileInfo info) => new(info.Length, info.LastWriteTimeUtc.Ticks);
    }

    private sealed class Session(
        string id,
        string roomId,
        string containerName,
        Process process,
        string workspaceDirectory,
        WorkspaceMaterialization workspace,
        RunnerNetwork? network)
    {
        internal string Id { get; } = id;
        internal string RoomId { get; } = roomId;
        internal string ContainerName { get; } = containerName;
        internal Process Process { get; } = process;
        internal string WorkspaceDirectory { get; } = workspaceDirectory;
        internal RunnerNetwork? Network { get; } = network;
        internal Dictionary<string, TerminalWorkspaceEntry> WorkspaceEntries { get; } = workspace.Entries;
        internal Dictionary<string, WorkspaceFileState> WorkspaceFileStates { get; } = workspace.FileStates;
        internal StringBuilder Output { get; } = new();
        internal SemaphoreSlim InputLock { get; } = new(1, 1);
        internal SemaphoreSlim OutputLock { get; } = new(1, 1);
        internal SemaphoreSlim WorkspaceLock { get; } = new(1, 1);
        internal DateTimeOffset CreatedAt { get; } = DateTimeOffset.UtcNow;
        internal DateTimeOffset LastActivity { get; set; } = DateTimeOffset.UtcNow;
        internal bool OutputLimitReached { get; set; }
        internal bool WorkspaceLimitExceeded { get; set; }
        internal bool WorkspaceLimitMessageWritten { get; set; }
        internal DateTimeOffset? ExitedAt { get; set; }
        internal int? ExitCode { get; set; }
        internal Task? OutputTask { get; set; }
        internal Task? ExitTask { get; set; }

        private int _slotReleased;

        internal bool TryReleaseSlot() => Interlocked.Exchange(ref _slotReleased, 1) == 0;
    }
}
