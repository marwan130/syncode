using System.Text.Json;
using Microsoft.Extensions.Hosting;

namespace Syncode.ExecutionService.Runner;

public sealed class PackageEgressBoundary : IHostedService
{
    private readonly IDockerCli _docker;
    private readonly PackageEgressPolicy _policy;

    public PackageEgressBoundary(IDockerCli docker, PackageEgressPolicy policy)
    {
        _docker = docker;
        _policy = policy;
    }

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        if (!_policy.Enabled) return;

        await EnsureEgressNetworkAsync(cancellationToken);
        await EnsureProxyAsync(cancellationToken);
        await RemoveAbandonedSessionNetworksAsync(cancellationToken);
    }

    public async Task<RunnerNetwork?> CreateSessionNetworkAsync(string sessionId, CancellationToken cancellationToken)
    {
        if (!_policy.Enabled) return null;
        var network = PackageEgressPolicy.SessionNetwork(sessionId);
        await _docker.RunTextAsync(
            [
                "network", "create", "--driver=bridge", "--internal",
                "--opt", "com.docker.network.bridge.gateway_mode_ipv4=isolated",
                "--opt", "com.docker.network.bridge.gateway_mode_ipv6=isolated",
                "--label", "syncode.package-session=true", network
            ],
            cancellationToken);
        try
        {
            var settings = await _docker.RunTextAsync(
                ["network", "inspect", "--format", "{{.Driver}}|{{.Internal}}|{{index .Labels \"syncode.package-session\"}}|{{index .Options \"com.docker.network.bridge.gateway_mode_ipv4\"}}|{{index .Options \"com.docker.network.bridge.gateway_mode_ipv6\"}}", network],
                cancellationToken);
            if (settings.Trim() != "bridge|true|true|isolated|isolated")
                throw new InvalidOperationException("The terminal network does not isolate its host gateway.");
            await _docker.RunTextAsync(
                ["network", "connect", network, PackageEgressPolicy.ProxyContainer],
                cancellationToken);
            var addressTemplate = $"{{{{(index .NetworkSettings.Networks \"{network}\").IPAddress}}}}";
            var address = (await _docker.RunTextAsync(
                ["inspect", "--format", addressTemplate, PackageEgressPolicy.ProxyContainer], cancellationToken)).Trim();
            if (!System.Net.IPAddress.TryParse(address, out var ipAddress) || ipAddress.AddressFamily != System.Net.Sockets.AddressFamily.InterNetwork)
                throw new InvalidOperationException("The package egress proxy has no IPv4 address on the isolated session network.");
            return new RunnerNetwork(network, address);
        }
        catch
        {
            await RemoveSessionNetworkAsync(new RunnerNetwork(network, string.Empty));
            throw;
        }
    }

    public async Task RemoveSessionNetworkAsync(RunnerNetwork? network)
    {
        if (network is null) return;
        await _docker.TryRunAsync(["network", "disconnect", "--force", network.Name, PackageEgressPolicy.ProxyContainer], CancellationToken.None);
        await _docker.TryRunAsync(["network", "rm", network.Name], CancellationToken.None);
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    private async Task EnsureEgressNetworkAsync(CancellationToken cancellationToken)
    {
        try
        {
            var label = await _docker.RunTextAsync(
                ["network", "inspect", "--format", "{{.Driver}}|{{.Internal}}|{{index .Labels \"syncode.package-egress\"}}", PackageEgressPolicy.EgressNetwork],
                cancellationToken);
            if (label.Trim() != "bridge|false|true")
                throw new InvalidOperationException("The package egress network is not managed by Syncode.");
        }
        catch (InvalidOperationException exception) when (exception.Message == "Docker command failed.")
        {
            await _docker.RunTextAsync(
                ["network", "create", "--driver=bridge", "--label", "syncode.package-egress=true", PackageEgressPolicy.EgressNetwork],
                cancellationToken);
        }
    }

    private async Task EnsureProxyAsync(CancellationToken cancellationToken)
    {
        var existing = await _docker.RunTextAsync(
            ["ps", "--all", "--filter", $"name=^{PackageEgressPolicy.ProxyContainer}$", "--format", "{{.Names}}"],
            cancellationToken);
        if (existing.Split('\n', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
            .Contains(PackageEgressPolicy.ProxyContainer, StringComparer.Ordinal))
        {
            var details = await _docker.RunTextAsync(
                ["inspect", "--format", "{{.Config.Image}}|{{index .Config.Labels \"syncode.package-egress\"}}|{{.State.Running}}|{{.HostConfig.NetworkMode}}|{{.HostConfig.Runtime}}|{{.HostConfig.ReadonlyRootfs}}|{{.Config.User}}|{{json .HostConfig.CapDrop}}|{{json .HostConfig.CapAdd}}|{{json .HostConfig.PortBindings}}|{{.HostConfig.Memory}}|{{.HostConfig.NanoCpus}}|{{.HostConfig.PidsLimit}}|{{json .HostConfig.SecurityOpt}}", PackageEgressPolicy.ProxyContainer],
                cancellationToken);
            var proxyDetails = details.Trim().Split('|');
            if (proxyDetails.Length != 14 || proxyDetails[0] != PackageEgressPolicy.ProxyImage || proxyDetails[1] != "true" ||
                proxyDetails[3] != PackageEgressPolicy.EgressNetwork || proxyDetails[4] != ContainerRuntimePolicy.GvisorRuntime ||
                proxyDetails[5] != "true" || proxyDetails[6] != "10001:10001" ||
                proxyDetails[7] != "[\"ALL\"]" || proxyDetails[8] != "[\"NET_BIND_SERVICE\"]" ||
                proxyDetails[9] is not ("{}" or "null") || proxyDetails[10] != "134217728" || proxyDetails[11] != "250000000" ||
                proxyDetails[12] != "32" || proxyDetails[13] != "[\"no-new-privileges:true\"]")
                throw new InvalidOperationException("The package egress proxy does not match the required isolated configuration.");
            if (proxyDetails[2] != "true")
                await _docker.RunTextAsync(["start", PackageEgressPolicy.ProxyContainer], cancellationToken);
            await EnsureProxyNetworkIsExclusiveAsync(cancellationToken);
            await WaitForProxyHealthAsync(cancellationToken);
            return;
        }

        await _docker.RunTextAsync(
        [
            "run", "--detach", "--name", PackageEgressPolicy.ProxyContainer, "--pull=never",
            ContainerRuntimePolicy.DockerArgument(ContainerRuntimePolicy.GvisorRuntime),
            "--label", "syncode.package-egress=true", "--network", PackageEgressPolicy.EgressNetwork,
            "--memory=128m", "--memory-swap=128m", "--cpus=0.25", "--pids-limit=32",
            "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=8m,uid=10001,gid=10001",
            "--cap-drop=ALL", "--cap-add=NET_BIND_SERVICE", "--security-opt=no-new-privileges", "--user=10001:10001",
            PackageEgressPolicy.ProxyImage
        ], cancellationToken);

        await EnsureProxyNetworkIsExclusiveAsync(cancellationToken);
        await WaitForProxyHealthAsync(cancellationToken);
    }

    private async Task WaitForProxyHealthAsync(CancellationToken cancellationToken)
    {
        for (var attempt = 0; attempt < 30; attempt++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var health = await _docker.RunTextAsync(
                ["inspect", "--format", "{{.State.Health.Status}}", PackageEgressPolicy.ProxyContainer], cancellationToken);
            if (health.Trim() == "healthy") return;
            await Task.Delay(TimeSpan.FromSeconds(1), cancellationToken);
        }

        await _docker.TryRunAsync(["rm", "-f", PackageEgressPolicy.ProxyContainer], CancellationToken.None);
        throw new InvalidOperationException("The package egress proxy did not become healthy.");
    }

    private async Task EnsureProxyNetworkIsExclusiveAsync(CancellationToken cancellationToken)
    {
        var containers = await _docker.RunTextAsync(
            ["network", "inspect", "--format", "{{json .Containers}}", PackageEgressPolicy.EgressNetwork],
            cancellationToken);
        using var document = JsonDocument.Parse(containers);
        var names = document.RootElement.EnumerateObject()
            .Select(container => container.Value.TryGetProperty("Name", out var name) ? name.GetString() : null)
            .Where(name => name is not null)
            .ToArray();
        if (names.Length != 1 || names[0] != PackageEgressPolicy.ProxyContainer)
            throw new InvalidOperationException("Only the isolated package proxy may join the package egress network.");
    }

    private async Task RemoveAbandonedSessionNetworksAsync(CancellationToken cancellationToken)
    {
        var networks = await _docker.RunTextAsync(
            ["network", "ls", "--filter", "label=syncode.package-session=true", "--format", "{{.Name}}"],
            cancellationToken);
        foreach (var network in networks.Split('\n', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
        {
            if (!network.StartsWith("syncode-terminal-net-", StringComparison.Ordinal)) continue;
            var attached = await _docker.RunTextAsync(
                ["network", "inspect", "--format", "{{.Created}}|{{json .Containers}}", network], cancellationToken);
            var separator = attached.IndexOf('|');
            if (separator < 0 || !DateTimeOffset.TryParse(attached[..separator], out var createdAt) ||
                DateTimeOffset.UtcNow - createdAt < TimeSpan.FromMinutes(2)) continue;
            using var document = JsonDocument.Parse(attached[(separator + 1)..]);
            var runnerNames = document.RootElement.EnumerateObject()
                .Select(container => container.Value.TryGetProperty("Name", out var name) ? name.GetString() : null)
                .Where(name => name?.StartsWith("syncode-terminal-", StringComparison.Ordinal) == true)
                .ToArray();
            var hasActiveRunner = false;
            foreach (var runner in runnerNames)
            {
                var running = await _docker.RunTextAsync(
                    ["inspect", "--format", "{{.State.Running}}", runner!], cancellationToken);
                if (running.Trim() == "true")
                {
                    hasActiveRunner = true;
                    break;
                }
                await _docker.TryRunAsync(["rm", "-f", runner!], cancellationToken);
            }
            var hasOtherContainer = document.RootElement.EnumerateObject().Any(container =>
                container.Value.TryGetProperty("Name", out var name) &&
                name.GetString() is { } value && value != PackageEgressPolicy.ProxyContainer &&
                !value.StartsWith("syncode-terminal-", StringComparison.Ordinal));
            if (!hasActiveRunner && !hasOtherContainer)
                await RemoveSessionNetworkAsync(new RunnerNetwork(network, string.Empty));
        }
    }
}

public sealed record RunnerNetwork(string Name, string ProxyAddress);
