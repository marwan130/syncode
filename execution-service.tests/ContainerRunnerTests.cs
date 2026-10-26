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
        var containerRuntime = Environment.GetEnvironmentVariable("SYNCODE_CONTAINER_RUNTIME") ?? "runc";
        var docker = new DockerCli();
        var registry = new ActiveContainerRegistry();
        var runner = new ContainerRunner(
            docker, registry, NullLogger<ContainerRunner>.Instance, containerRuntime: containerRuntime);
        var programs = new (ExecutionLanguage Language, string Source, string ExpectedOutput)[]
        {
            (ExecutionLanguage.JavaScript, "console.log('javascript-ready')", "javascript-ready"),
            (ExecutionLanguage.TypeScript, "console.log('typescript-ready')", "typescript-ready"),
            (ExecutionLanguage.Python, "print('python-ready')", "python-ready"),
            (ExecutionLanguage.CSharp, "Console.WriteLine(\"csharp-ready\");", "csharp-ready"),
            (ExecutionLanguage.C, "#include <stdio.h>\nint main(void) { puts(\"c-ready\"); return 0; }", "c-ready"),
            (ExecutionLanguage.Cpp, "#include <iostream>\nint main() { std::cout << \"cpp-ready\" << std::endl; }", "cpp-ready"),
            (ExecutionLanguage.Rust, "fn main() { println!(\"rust-ready\"); }", "rust-ready"),
            (ExecutionLanguage.Java, "public class Main { public static void main(String[] args) { System.out.println(\"java-ready\"); } }", "java-ready")
        };

        foreach (var (language, source, expectedOutput) in programs)
        {
            var output = await RunAndCaptureAsync(runner, language, source);
            Assert.True(output.Result.ExitCode == 0,
                $"{language} container returned {output.Result.ExitCode}: {output.Text}");
            Assert.Contains(expectedOutput, output.Text);
        }

        var timeoutRunner = new ContainerRunner(
            docker, registry, NullLogger<ContainerRunner>.Instance,
            new ResourceLimits { Timeout = TimeSpan.FromSeconds(1) }, containerRuntime);
        var timedResult = await timeoutRunner.RunAsync(
            CreateJob("while (true) {}", ExecutionLanguage.JavaScript), _ => ValueTask.CompletedTask);
        Assert.True(timedResult.TimedOut);

        var networkScript = "const net=require('net'); const s=net.connect(80,'1.1.1.1'); s.setTimeout(2000,()=>{console.log('network-blocked');s.destroy()}); s.on('error',()=>console.log('network-blocked'));";
        var networkOutput = await RunAndCaptureAsync(runner, ExecutionLanguage.JavaScript, networkScript);
        Assert.Contains("network-blocked", networkOutput.Text);

        var tmpfsScript = "try { require('fs').writeFileSync('/tmp/large', Buffer.alloc(11 * 1024 * 1024)); console.log('write-succeeded'); } catch (error) { console.log(error.code); }";
        var tmpfsOutput = await RunAndCaptureAsync(runner, ExecutionLanguage.JavaScript, tmpfsScript);
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
        Assert.Contains("--runtime=runc", runArgs);
        Assert.Contains("--interactive", runArgs);
        Assert.DoesNotContain("--tty", runArgs);
        Assert.Contains("--network=none", runArgs);
        Assert.Contains("--read-only", runArgs);
        Assert.Contains("--cap-drop=ALL", runArgs);
        Assert.Contains("--security-opt=no-new-privileges", runArgs);
        Assert.Contains("--memory", runArgs);
        Assert.Contains("--cpus", runArgs);
        Assert.Contains("--pids-limit", runArgs);
        Assert.Contains("--ulimit", runArgs);
        Assert.Contains("nofile=256:256", runArgs);
        Assert.Contains("fsize=16777216:16777216", runArgs);
        Assert.Contains(runArgs, arg => arg.StartsWith("/tmp:rw,noexec,nosuid,nodev,size=10m", StringComparison.Ordinal));
        Assert.Contains(runArgs, arg => arg.StartsWith("type=bind,source=", StringComparison.Ordinal) && arg.EndsWith(",readonly", StringComparison.Ordinal));
        Assert.Contains("syncode-runner-node", runArgs);
        Assert.Contains(docker.CleanupArguments, args => args.SequenceEqual(["rm", "-f", Assert.IsType<string>(runArgs[2])]));
    }

    [Fact]
    public async Task RunAsync_ConfiguresTypeScriptModeInTheNodeImage()
    {
        var docker = new FakeDockerCli();
        var runner = CreateRunner(docker);

        await runner.RunAsync(CreateJob("console.log('typescript-ready')", ExecutionLanguage.TypeScript),
            _ => ValueTask.CompletedTask);

        var runArgs = Assert.Single(docker.StreamingArguments);
        Assert.Contains("syncode-runner-node", runArgs);
        Assert.Contains("RUNNER_RUNTIME=typescript", runArgs);
        Assert.Contains(runArgs, arg => arg.EndsWith(",target=/workspace/main.ts,readonly", StringComparison.Ordinal));
    }

    [Fact]
    public async Task RunAsync_GivesCSharpCompilationItsBoundedMemoryLimit()
    {
        var docker = new FakeDockerCli();
        var runner = CreateRunner(docker);

        await runner.RunAsync(CreateJob("Console.WriteLine(\"ready\");", ExecutionLanguage.CSharp),
            _ => ValueTask.CompletedTask);

        var runArgs = Assert.Single(docker.StreamingArguments);
        var memoryIndex = runArgs.ToList().IndexOf("--memory");
        var memorySwapIndex = runArgs.ToList().IndexOf("--memory-swap");
        Assert.Equal("4294967296b", runArgs[memoryIndex + 1]);
        Assert.Equal("4294967296b", runArgs[memorySwapIndex + 1]);
        var processLimitIndex = runArgs.ToList().IndexOf("--pids-limit");
        Assert.Equal("128", runArgs[processLimitIndex + 1]);
        Assert.Contains(runArgs, arg => arg.StartsWith("/runner:rw,exec,nosuid,nodev,size=128m", StringComparison.Ordinal));
        Assert.Contains("fsize=134217728:134217728", runArgs);
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

    [Fact]
    public async Task RunAsync_MountsProjectFilesIntoTheIsolatedWorkspace()
    {
        var docker = new FakeDockerCli();
        var runner = CreateRunner(docker);
        var job = CreateJob() with
        {
            SourcePath = "src/main.js",
            ProjectFiles =
            [
                new ExecutionProjectFile("src/main.js", "console.log(require('./helper'))"),
                new ExecutionProjectFile("src/helper.js", "module.exports = 'ready'")
            ]
        };

        await runner.RunAsync(job, _ => ValueTask.CompletedTask);

        var args = Assert.Single(docker.StreamingArguments);
        Assert.Contains("SYNCODE_SOURCE_PATH=src/main.js", args);
        Assert.Contains(args, arg => arg.StartsWith("type=bind,source=", StringComparison.Ordinal) &&
            arg.Contains(",target=/workspace,readonly", StringComparison.Ordinal));
    }

    [Fact]
    public async Task RunAsync_RejectsProjectPathTraversalBeforeStartingContainer()
    {
        var docker = new FakeDockerCli();
        var runner = CreateRunner(docker);
        var job = CreateJob() with
        {
            SourcePath = "../main.js",
            ProjectFiles = [new ExecutionProjectFile("../main.js", "console.log('unsafe')")]
        };

        await Assert.ThrowsAsync<ArgumentException>(() => runner.RunAsync(job, _ => ValueTask.CompletedTask));

        Assert.Empty(docker.StreamingArguments);
    }

    [Fact]
    public async Task RunAsync_UsesConfiguredGvisorRuntime()
    {
        var docker = new FakeDockerCli();
        var runner = new ContainerRunner(
            docker, new ActiveContainerRegistry(), NullLogger<ContainerRunner>.Instance,
            containerRuntime: ContainerRuntimePolicy.GvisorRuntime);

        await runner.RunAsync(CreateJob(), _ => ValueTask.CompletedTask);

        Assert.Contains("--runtime=runsc", Assert.Single(docker.StreamingArguments));
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
            string executionId,
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

        public Task WriteExecutionInputAsync(string executionId, string input, CancellationToken cancellationToken) => Task.CompletedTask;

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
