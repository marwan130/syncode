using System.Diagnostics;
using System.Text;
using Microsoft.Extensions.Logging;
using Syncode.ExecutionService.Security;

namespace Syncode.ExecutionService.Runner;

public sealed class ContainerRunner
{
    private const string ContainerLabel = "syncode.execution=true";
    private const int RunnerUserId = 10001;

    private readonly IDockerCli _docker;
    private readonly ActiveContainerRegistry _activeContainers;
    private readonly ResourceLimits _limits;
    private readonly ILogger<ContainerRunner> _logger;
    private readonly string _containerRuntime;

    public ContainerRunner(
        IDockerCli docker,
        ActiveContainerRegistry activeContainers,
        ILogger<ContainerRunner> logger,
        ResourceLimits? limits = null,
        string containerRuntime = "runc")
    {
        _docker = docker;
        _activeContainers = activeContainers;
        _logger = logger;
        _limits = limits ?? ResourceLimits.Default;
        _containerRuntime = containerRuntime;
    }

    public async Task<ExecutionResult> RunAsync(
        ExecutionJob job,
        Func<ExecutionOutputChunk, ValueTask> onOutput,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(job);
        ArgumentNullException.ThrowIfNull(onOutput);
        ArgumentNullException.ThrowIfNull(job.Source);

        var sourceBytes = Encoding.UTF8.GetByteCount(job.Source);
        if (sourceBytes > _limits.MaxSourceBytes)
            throw new ArgumentException($"Source exceeds the {_limits.MaxSourceBytes}-byte limit.", nameof(job));
        if (job.ProjectFiles is { } projectFiles)
            ValidateProjectFiles(job, projectFiles, sourceBytes);

        var (image, sourceName) = job.Language switch
        {
            ExecutionLanguage.JavaScript => ("syncode-runner-node", "main.js"),
            ExecutionLanguage.TypeScript => ("syncode-runner-node", "main.ts"),
            ExecutionLanguage.Python => ("syncode-runner-python", "main.py"),
            ExecutionLanguage.CSharp => ("syncode-runner-dotnet", "Program.cs"),
            ExecutionLanguage.C => ("syncode-runner-c", "main.c"),
            ExecutionLanguage.Cpp => ("syncode-runner-cpp", "main.cpp"),
            ExecutionLanguage.Rust => ("syncode-runner-rust", "main.rs"),
            ExecutionLanguage.Java => ("syncode-runner-java", "Main.java"),
            _ => throw new ArgumentOutOfRangeException(nameof(job), "Unsupported execution language.")
        };

        var containerName = $"syncode-exec-{Guid.NewGuid():N}";
        var sourceDirectory = Path.Combine(Path.GetTempPath(), containerName);
        Directory.CreateDirectory(sourceDirectory);

        try
        {
            if (job.ProjectFiles is { Count: > 0 })
            {
                foreach (var file in job.ProjectFiles)
                {
                    if (file.Path == job.SourcePath) continue;
                    var relativePath = ValidateProjectPath(file.Path);
                    var projectPath = Path.GetFullPath(Path.Combine(sourceDirectory, relativePath));
                    if (!projectPath.StartsWith(sourceDirectory + Path.DirectorySeparatorChar, StringComparison.Ordinal))
                        throw new ArgumentException("Project file path is outside the execution workspace.", nameof(job));
                    Directory.CreateDirectory(Path.GetDirectoryName(projectPath)!);
                    await File.WriteAllTextAsync(projectPath, file.Content, new UTF8Encoding(false), cancellationToken);
                }
                var selectedPath = Path.GetFullPath(Path.Combine(sourceDirectory, ValidateProjectPath(job.SourcePath)));
                if (!selectedPath.StartsWith(sourceDirectory + Path.DirectorySeparatorChar, StringComparison.Ordinal))
                    throw new ArgumentException("Selected source path is outside the execution workspace.", nameof(job));
                Directory.CreateDirectory(Path.GetDirectoryName(selectedPath)!);
                await File.WriteAllTextAsync(selectedPath, job.Source, new UTF8Encoding(false), cancellationToken);
            }
            var sourcePath = job.ProjectFiles is { Count: > 0 }
                ? Path.GetFullPath(Path.Combine(sourceDirectory, ValidateProjectPath(job.SourcePath)))
                : Path.Combine(sourceDirectory, sourceName);
            if (job.ProjectFiles is not { Count: > 0 })
                await File.WriteAllTextAsync(sourcePath, job.Source, new UTF8Encoding(false), cancellationToken);
            _activeContainers.Add(containerName);

            var outputBytes = 0;
            var outputLimitExceeded = 0;
            var killRequested = 0;
            var startedAt = Stopwatch.GetTimestamp();
            using var timeout = new CancellationTokenSource(_limits.Timeout);
            using var linkedCancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeout.Token);

            var arguments = BuildRunArguments(containerName, image, sourcePath, sourceName,
                job.ProjectFiles is { Count: > 0 }, job.SourcePath, sourceDirectory);
            int exitCode;
            try
            {
                exitCode = await _docker.RunStreamingAsync(job.Id, arguments, async (stream, text) =>
                {
                    var bytes = Encoding.UTF8.GetByteCount(text);
                    var total = Interlocked.Add(ref outputBytes, bytes);
                    if (total > _limits.MaxOutputBytes)
                    {
                        Interlocked.Exchange(ref outputLimitExceeded, 1);
                        if (Interlocked.Exchange(ref killRequested, 1) == 0)
                            await _docker.TryRunAsync(["kill", containerName], CancellationToken.None);
                        return;
                    }

                    await onOutput(new ExecutionOutputChunk(stream, text));
                }, linkedCancellation.Token);
            }
            catch (OperationCanceledException) when (timeout.IsCancellationRequested && !cancellationToken.IsCancellationRequested)
            {
                return new ExecutionResult(-1, TimedOut: true, outputLimitExceeded != 0, Stopwatch.GetElapsedTime(startedAt));
            }
            finally
            {
                await StopAndRemoveAsync(containerName);
            }

            return new ExecutionResult(exitCode, TimedOut: false, outputLimitExceeded != 0, Stopwatch.GetElapsedTime(startedAt));
        }
        finally
        {
            _activeContainers.Remove(containerName);
            try
            {
                Directory.Delete(sourceDirectory, recursive: true);
            }
            catch (IOException exception)
            {
                _logger.LogWarning(exception, "Could not remove temporary execution source directory {Directory}", sourceDirectory);
            }
            catch (UnauthorizedAccessException exception)
            {
                _logger.LogWarning(exception, "Could not remove temporary execution source directory {Directory}", sourceDirectory);
            }
        }
    }

    private List<string> BuildRunArguments(
        string name,
        string image,
        string sourcePath,
        string sourceName,
        bool mountProjectDirectory,
        string projectSourcePath,
        string sourceDirectory)
    {
        var arguments = new List<string>
        {
        "run", "--name", name,
        "--interactive",
        "--pull=never",
        ContainerRuntimePolicy.DockerArgument(_containerRuntime),
        "--label", ContainerLabel,
        "--network=none",
        "--memory", $"{_limits.MemoryBytes}b",
        "--memory-swap", $"{_limits.MemoryBytes}b",
        "--cpus", _limits.CpuCount.ToString(System.Globalization.CultureInfo.InvariantCulture),
        "--pids-limit", _limits.ProcessLimit.ToString(System.Globalization.CultureInfo.InvariantCulture),
        "--ulimit", $"nofile={_limits.OpenFileLimit}:{_limits.OpenFileLimit}",
        "--ulimit", "fsize=16777216:16777216",
        "--read-only",
        "--tmpfs", $"/tmp:rw,noexec,nosuid,nodev,size={_limits.TemporaryStorageMegabytes}m,uid={RunnerUserId},gid={RunnerUserId}",
        "--tmpfs", $"/runner:rw,exec,nosuid,nodev,size={_limits.BuildStorageMegabytes}m,uid={RunnerUserId},gid={RunnerUserId}",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--user", $"{RunnerUserId}:{RunnerUserId}",
        "--env", $"SYNCODE_SOURCE_PATH={projectSourcePath}",
        "--mount", BuildMountSpecification(mountProjectDirectory ? sourceDirectory : sourcePath,
            mountProjectDirectory ? "/workspace" : $"/workspace/{sourceName}"),
        image
        };
        return arguments;
    }

    private static string BuildMountSpecification(string sourcePath, string target)
    {
        var sourceField = $"source={sourcePath}";
        if (sourcePath.Contains(','))
            sourceField = $"\"{sourceField}\"";
        return $"type=bind,{sourceField},target={target},readonly";
    }

    private static string ValidateProjectPath(string path)
    {
        if (string.IsNullOrWhiteSpace(path) || path.Length > 512 || Path.IsPathRooted(path) ||
            path.Contains('\\') || path.Any(char.IsControl))
            throw new ArgumentException("Invalid project file path.", nameof(path));
        var segments = path.Split('/');
        if (segments.Any(segment => segment.Length == 0 || segment is "." or ".." ||
                segment.IndexOfAny([ ':', '*', '?', '"', '<', '>', '|' ]) >= 0))
            throw new ArgumentException("Invalid project file path.", nameof(path));
        return Path.Combine(segments);
    }

    private void ValidateProjectFiles(ExecutionJob job, IReadOnlyList<ExecutionProjectFile> files, int sourceBytes)
    {
        if (files.Count is < 1 or > 500 || files.Any(file => file is null || file.Content is null || string.IsNullOrEmpty(file.Path)) ||
            files.Select(file => file.Path).Distinct(StringComparer.Ordinal).Count() != files.Count ||
            !files.Any(file => file.Path == job.SourcePath))
            throw new ArgumentException("Project files exceed the execution limits or contain invalid paths.", nameof(job));

        foreach (var file in files) ValidateProjectPath(file.Path);
        var projectBytes = files.Sum(file => (long)Encoding.UTF8.GetByteCount(file.Content));
        var selectedBytes = Encoding.UTF8.GetByteCount(files.First(file => file.Path == job.SourcePath).Content);
        if (projectBytes - selectedBytes + sourceBytes > _limits.MaxSourceBytes)
            throw new ArgumentException("Project files exceed the execution source limit.", nameof(job));
    }

    private async Task StopAndRemoveAsync(string containerName)
    {
        await _docker.TryRunAsync(["kill", containerName], CancellationToken.None);
        await _docker.TryRunAsync(["rm", "-f", containerName], CancellationToken.None);
    }
}
