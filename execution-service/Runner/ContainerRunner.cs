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

    public ContainerRunner(
        IDockerCli docker,
        ActiveContainerRegistry activeContainers,
        ILogger<ContainerRunner> logger,
        ResourceLimits? limits = null)
    {
        _docker = docker;
        _activeContainers = activeContainers;
        _logger = logger;
        _limits = limits ?? ResourceLimits.Default;
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

        var (image, sourceName) = job.Language switch
        {
            ExecutionLanguage.JavaScript => ("syncode-runner-node", "main.js"),
            ExecutionLanguage.Python => ("syncode-runner-python", "main.py"),
            _ => throw new ArgumentOutOfRangeException(nameof(job), "Unsupported execution language.")
        };

        var containerName = $"syncode-exec-{Guid.NewGuid():N}";
        var sourceDirectory = Path.Combine(Path.GetTempPath(), containerName);
        var sourcePath = Path.Combine(sourceDirectory, sourceName);
        Directory.CreateDirectory(sourceDirectory);

        try
        {
            await File.WriteAllTextAsync(sourcePath, job.Source, new UTF8Encoding(false), cancellationToken);
            _activeContainers.Add(containerName);

            var outputBytes = 0;
            var outputLimitExceeded = 0;
            var killRequested = 0;
            var startedAt = Stopwatch.GetTimestamp();
            using var timeout = new CancellationTokenSource(_limits.Timeout);
            using var linkedCancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeout.Token);

            var arguments = BuildRunArguments(containerName, image, sourcePath, sourceName);
            int exitCode;
            try
            {
                exitCode = await _docker.RunStreamingAsync(arguments, async (stream, text) =>
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

    private IReadOnlyList<string> BuildRunArguments(string name, string image, string sourcePath, string sourceName) =>
    [
        "run", "--name", name,
        "--pull=never",
        "--label", ContainerLabel,
        "--network=none",
        "--memory", $"{_limits.MemoryBytes}b",
        "--memory-swap", $"{_limits.MemoryBytes}b",
        "--cpus", _limits.CpuCount.ToString(System.Globalization.CultureInfo.InvariantCulture),
        "--pids-limit", _limits.ProcessLimit.ToString(System.Globalization.CultureInfo.InvariantCulture),
        "--read-only",
        "--tmpfs", $"/tmp:rw,noexec,nosuid,nodev,size={_limits.TemporaryStorageMegabytes}m,uid={RunnerUserId},gid={RunnerUserId}",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--user", $"{RunnerUserId}:{RunnerUserId}",
        "--mount", BuildMountSpecification(sourcePath, sourceName),
        image
    ];

    private static string BuildMountSpecification(string sourcePath, string sourceName)
    {
        var sourceField = $"source={sourcePath}";
        if (sourcePath.Contains(','))
            sourceField = $"\"{sourceField}\"";
        return $"type=bind,{sourceField},target=/workspace/{sourceName},readonly";
    }

    private async Task StopAndRemoveAsync(string containerName)
    {
        await _docker.TryRunAsync(["kill", containerName], CancellationToken.None);
        await _docker.TryRunAsync(["rm", "-f", containerName], CancellationToken.None);
    }
}
