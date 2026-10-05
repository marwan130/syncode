using System.Globalization;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Syncode.ExecutionService.Security;

namespace Syncode.ExecutionService.Runner;

public sealed class ContainerLifecycle : BackgroundService
{
    private const string ContainerLabelFilter = "label=syncode.execution=true";

    private readonly IDockerCli _docker;
    private readonly ActiveContainerRegistry _activeContainers;
    private readonly ResourceLimits _limits;
    private readonly ILogger<ContainerLifecycle> _logger;

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
            ["ps", "--all", "--filter", ContainerLabelFilter, "--format", "{{.ID}}|{{.Names}}"],
            cancellationToken);

        foreach (var row in containers.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var parts = row.Split('|', 2);
            if (parts.Length != 2 || _activeContainers.Contains(parts[1]))
                continue;

            var details = await _docker.RunTextAsync(
                ["inspect", "--format", "{{.State.Status}}|{{.State.StartedAt}}|{{.Created}}", parts[0]],
                cancellationToken);
            var detailParts = details.Trim().Split('|', 3);
            if (detailParts.Length != 3)
                continue;

            var isStale = detailParts[0] != "running";
            if (!isStale && DateTimeOffset.TryParse(detailParts[1], CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var startedAt))
                isStale = DateTimeOffset.UtcNow - startedAt > _limits.Timeout + _limits.OrphanGracePeriod;
            else if (!isStale && DateTimeOffset.TryParse(detailParts[2], CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var createdAt))
                isStale = DateTimeOffset.UtcNow - createdAt > _limits.Timeout + _limits.OrphanGracePeriod;

            if (!isStale)
                continue;

            _logger.LogWarning("Removing orphaned execution container {ContainerName}", parts[1]);
            if (detailParts[0] == "running")
                await _docker.TryRunAsync(["kill", parts[0]], cancellationToken);
            await _docker.TryRunAsync(["rm", "-f", parts[0]], cancellationToken);
        }
    }
}
