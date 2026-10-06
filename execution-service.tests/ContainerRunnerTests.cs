using Microsoft.Extensions.Logging.Abstractions;
using Syncode.ExecutionService.Runner;
using Syncode.ExecutionService.Security;
using Xunit;

namespace Syncode.ExecutionService.Tests;

public sealed class ContainerRunnerTests
{
    [DockerIntegrationFact]
    [Trait("Category", "DockerIntegration")]
    public async Task RunAsync_ExecutesLanguagesAndEnforcesContainerBoundaries()
    {
        var docker = new DockerCli();
        var registry = new ActiveContainerRegistry();
        var nodeRunner = new ContainerRunner(docker, registry, NullLogger<ContainerRunner>.Instance);
        var pythonRunner = new ContainerRunner(docker, registry, NullLogger<ContainerRunner>.Instance);

        var nodeOutput = await RunAndCaptureAsync(nodeRunner, ExecutionLanguage.JavaScript, "console.log('node-ready')");
        Assert.True(nodeOutput.Result.ExitCode == 0, $"Node container returned {nodeOutput.Result.ExitCode}: {nodeOutput.Text}");
        Assert.Contains("node-ready", nodeOutput.Text);

        var pythonOutput = await RunAndCaptureAsync(pythonRunner, ExecutionLanguage.Python, "print('python-ready')");
        Assert.Equal(0, pythonOutput.Result.ExitCode);
        Assert.Contains("python-ready", pythonOutput.Text);

        var timeoutRunner = new ContainerRunner(
            docker, registry, NullLogger<ContainerRunner>.Instance,
            new ResourceLimits { Timeout = TimeSpan.FromSeconds(1) });
        var timedResult = await timeoutRunner.RunAsync(
            CreateJob("while (true) {}", ExecutionLanguage.JavaScript), _ => ValueTask.CompletedTask);
        Assert.True(timedResult.TimedOut);

        var networkScript = "const net=require('net'); const s=net.connect(80,'1.1.1.1'); s.setTimeout(2000,()=>{console.log('network-blocked');s.destroy()}); s.on('error',()=>console.log('network-blocked'));";
        var networkOutput = await RunAndCaptureAsync(nodeRunner, ExecutionLanguage.JavaScript, networkScript);
        Assert.Contains("network-blocked", networkOutput.Text);

        var tmpfsScript = "try { require('fs').writeFileSync('/tmp/large', Buffer.alloc(11 * 1024 * 1024)); console.log('write-succeeded'); } catch (error) { console.log(error.code); }";
        var tmpfsOutput = await RunAndCaptureAsync(nodeRunner, ExecutionLanguage.JavaScript, tmpfsScript);
        Assert.Contains("ENOSPC", tmpfsOutput.Text);
    }

    [Fact]
    public async Task RunAsync_AppliesIsolationLimitsAndStreamsOutput()
    {
        var docker = new FakeDockerCli();
        var runner = CreateRunner(docker);
        var received = new List<ExecutionOutputChunk>();

        var result = await runner.RunAsync(
            CreateJob(),
            chunk =>
            {
                received.Add(chunk);
                return ValueTask.CompletedTask;
            });

        Assert.Equal(0, result.ExitCode);
        Assert.False(result.TimedOut);
        Assert.Equal("hello\n", Assert.Single(received).Text);
        var runArgs = Assert.Single(docker.StreamingArguments);
        Assert.Contains("--network=none", runArgs);
        Assert.Contains("--read-only", runArgs);
        Assert.Contains("--cap-drop=ALL", runArgs);
        Assert.Contains("--security-opt=no-new-privileges", runArgs);
        Assert.Contains("--memory", runArgs);
        Assert.Contains("--cpus", runArgs);
        Assert.Contains("--pids-limit", runArgs);
        Assert.Contains(runArgs, arg => arg.StartsWith("/tmp:rw,noexec,nosuid,nodev,size=10m", StringComparison.Ordinal));
        Assert.Contains(runArgs, arg => arg.StartsWith("type=bind,source=", StringComparison.Ordinal) && arg.EndsWith(",readonly", StringComparison.Ordinal));
        Assert.Contains("syncode-runner-node", runArgs);
        Assert.Contains(docker.CleanupArguments, args => args.SequenceEqual(["rm", "-f", Assert.IsType<string>(runArgs[2])]));
    }

    [Fact]
    public async Task RunAsync_ReportsTimeoutAndRemovesContainer()
    {
        var docker = new FakeDockerCli { WaitUntilCancelled = true };
        var runner = CreateRunner(docker, new ResourceLimits { Timeout = TimeSpan.FromMilliseconds(50) });

        var result = await runner.RunAsync(CreateJob(), _ => ValueTask.CompletedTask);

        Assert.True(result.TimedOut);
        Assert.Contains(docker.CleanupArguments, args => args[0] == "rm");
    }

    [Fact]
    public async Task RunAsync_StopsAndFlagsExcessiveOutput()
    {
        var docker = new FakeDockerCli { Output = "too much output" };
        var runner = CreateRunner(docker, new ResourceLimits { MaxOutputBytes = 5 });
        var callbackCount = 0;

        var result = await runner.RunAsync(CreateJob(), _ =>
        {
            callbackCount++;
            return ValueTask.CompletedTask;
        });

        Assert.True(result.OutputLimitExceeded);
        Assert.Equal(0, callbackCount);
        Assert.Contains(docker.CleanupArguments, args => args[0] == "kill");
    }

    [Fact]
    public async Task RunAsync_RejectsOversizedSourceBeforeStartingContainer()
    {
        var docker = new FakeDockerCli();
        var runner = CreateRunner(docker, new ResourceLimits { MaxSourceBytes = 4 });

        await Assert.ThrowsAsync<ArgumentException>(() => runner.RunAsync(
            CreateJob(source: "12345"), _ => ValueTask.CompletedTask));

        Assert.Empty(docker.StreamingArguments);
    }

    private static ContainerRunner CreateRunner(FakeDockerCli docker, ResourceLimits? limits = null) =>
        new(docker, new ActiveContainerRegistry(), NullLogger<ContainerRunner>.Instance, limits);

    private static ExecutionJob CreateJob(
        string source = "console.log('hello')",
        ExecutionLanguage language = ExecutionLanguage.JavaScript) =>
        new("job-id", "room-id", "user-id", language, source, DateTimeOffset.UtcNow);

    private static async Task<(ExecutionResult Result, string Text)> RunAndCaptureAsync(
        ContainerRunner runner,
        ExecutionLanguage language,
        string source)
    {
        var output = new System.Text.StringBuilder();
        var result = await runner.RunAsync(CreateJob(source, language), chunk =>
        {
            output.Append(chunk.Text);
            return ValueTask.CompletedTask;
        });
        return (result, output.ToString());
    }

    private sealed class FakeDockerCli : IDockerCli
    {
        public List<IReadOnlyList<string>> StreamingArguments { get; } = [];
        public List<IReadOnlyList<string>> CleanupArguments { get; } = [];
        public string Output { get; init; } = "hello\n";
        public bool WaitUntilCancelled { get; init; }

        public async Task<int> RunStreamingAsync(
            IReadOnlyList<string> arguments,
            Func<ExecutionOutputStream, string, ValueTask> onOutput,
            CancellationToken cancellationToken)
        {
            StreamingArguments.Add(arguments);
            if (WaitUntilCancelled)
                await Task.Delay(Timeout.Infinite, cancellationToken);
            else
                await onOutput(ExecutionOutputStream.StandardOutput, Output);
            return 0;
        }

        public Task<string> RunTextAsync(IReadOnlyList<string> arguments, CancellationToken cancellationToken) => Task.FromResult(string.Empty);

        public Task TryRunAsync(IReadOnlyList<string> arguments, CancellationToken cancellationToken)
        {
            CleanupArguments.Add(arguments);
            return Task.CompletedTask;
        }
    }
}

public sealed class DockerIntegrationFactAttribute : FactAttribute
{
    public DockerIntegrationFactAttribute()
    {
        if (Environment.GetEnvironmentVariable("SYNCODE_RUN_DOCKER_INTEGRATION") != "1")
            Skip = "Set SYNCODE_RUN_DOCKER_INTEGRATION=1 to run Docker integration checks.";
    }
}
