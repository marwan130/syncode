using System.Globalization;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Syncode.ExecutionService.Security;

namespace Syncode.ExecutionService.Runner;

public sealed class ContainerLifecycle : BackgroundService
{
    private static readonly TimeSpan ContainerCountLogInterval = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan TerminalMaxOrphanAge = TimeSpan.FromMinutes(15);

    private readonly IDockerCli _docker;
    private readonly ActiveContainerRegistry _activeContainers;
    private readonly ResourceLimits _limits;
    private readonly ILogger<ContainerLifecycle> _logger;
    private DateTimeOffset _lastCountLog = DateTimeOffset.MinValue;

    public ContainerLifecycle(
        IDockerCli docker,
        ActiveContainerRegistry activeContainers,
        ILogger<ContainerLifecycle> logger,
        ResourceLimits? limits = null)
    {
        _docker = docker;
        _activeContainers = activeContainers;
        _logger = logger;
        _limits = limits ?? ResourceLimits.Default;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(30));
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await SweepAsync(stoppingToken);
                await timer.WaitForNextTickAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception)
            {
                _logger.LogWarning(exception, "Container cleanup sweep failed; it will retry on the next interval");
                try
                {
                    await timer.WaitForNextTickAsync(stoppingToken);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    break;
                }
            }
        }
    }

    private async Task SweepAsync(CancellationToken cancellationToken)
    {
        var containers = await _docker.RunTextAsync(
            ["ps", "--all", "--format", "{{.ID}}|{{.Names}}|{{.State}}|{{.Labels}}"],
            cancellationToken);

        var managed = containers.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(row => row.Split('|', 4))
            .Where(parts => parts.Length == 4 && IsManagedContainer(parts[1], parts[3]))
            .ToArray();
        var now = DateTimeOffset.UtcNow;
        if (_lastCountLog == DateTimeOffset.MinValue || now - _lastCountLog >= ContainerCountLogInterval)
        {
            _logger.LogInformation("Runner container count: {TotalContainers} total, {RunningContainers} running",
                managed.Length, managed.Count(parts => parts[2] == "running"));
            _lastCountLog = now;
        }

        foreach (var parts in managed)
        {
            var containerId = parts[0];
            var containerName = parts[1];
            if (_activeContainers.Contains(containerName))
                continue;

            var details = await _docker.RunTextAsync(
                ["inspect", "--format", "{{.State.Status}}|{{.State.StartedAt}}|{{.Created}}", containerId],
                cancellationToken);
            var detailParts = details.Trim().Split('|', 3);
            if (detailParts.Length != 3)
                continue;

            var isTerminal = containerName.StartsWith("syncode-terminal-", StringComparison.Ordinal);
            var maxAge = isTerminal ? TerminalMaxOrphanAge : _limits.Timeout + _limits.OrphanGracePeriod;

            var isStale = detailParts[0] != "running";
            if (!isStale && DateTimeOffset.TryParse(detailParts[1], CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var startedAt))
                isStale = DateTimeOffset.UtcNow - startedAt > maxAge;
            else if (!isStale && DateTimeOffset.TryParse(detailParts[2], CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var createdAt))
                isStale = DateTimeOffset.UtcNow - createdAt > maxAge;

            if (!isStale)
                continue;

            _logger.LogWarning("Removing orphaned {ContainerType} container {ContainerName}", isTerminal ? "terminal" : "execution", containerName);
            if (detailParts[0] == "running")
                await _docker.TryRunAsync(["kill", containerId], cancellationToken);
            await _docker.TryRunAsync(["rm", "-f", containerId], cancellationToken);
        }
    }

    private static bool IsManagedContainer(string name, string labels)
    {
        var isExecution = name.StartsWith("syncode-exec-", StringComparison.Ordinal) &&
            labels.Split(',', StringSplitOptions.TrimEntries).Contains("syncode.execution=true", StringComparer.Ordinal);
        var isTerminal = name.StartsWith("syncode-terminal-", StringComparison.Ordinal) &&
            labels.Split(',', StringSplitOptions.TrimEntries).Contains("syncode.terminal=true", StringComparer.Ordinal);
        return isExecution || isTerminal;
    }

}
