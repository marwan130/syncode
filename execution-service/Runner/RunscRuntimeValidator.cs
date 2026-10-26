using Microsoft.Extensions.Hosting;

namespace Syncode.ExecutionService.Runner;

public sealed class RunscRuntimeValidator(IDockerCli docker) : IHostedService
{
    public async Task StartAsync(CancellationToken cancellationToken)
    {
        var runtimes = await docker.RunTextAsync(
            ["info", "--format", "{{json .Runtimes}}"], cancellationToken);
        if (!ContainerRuntimePolicy.IsAvailable(runtimes, ContainerRuntimePolicy.GvisorRuntime))
            throw new InvalidOperationException("The Docker daemon does not have the required runsc runtime configured.");

        await docker.RunTextAsync(
        [
            "run", "--rm", "--pull=never", ContainerRuntimePolicy.DockerArgument(ContainerRuntimePolicy.GvisorRuntime),
            "--network=none", "--memory=32m", "--memory-swap=32m", "--pids-limit=8", "--read-only",
            "--cap-drop=ALL", "--security-opt=no-new-privileges", "--user=10001:10001",
            "--entrypoint=/bin/true", "syncode-runner-bash"
        ], cancellationToken);
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}
