using Microsoft.Extensions.Logging.Abstractions;
using Syncode.ExecutionService.Runner;
using Xunit;

namespace Syncode.ExecutionService.Tests;

public sealed class GVisorIsolationTests
{
    [GVisorIntegrationFact]
    [Trait("Category", "GVisorIntegration")]
    public async Task RunAsync_BlocksHostAccessAndDangerousKernelOperations()
    {
        var runner = new ContainerRunner(
            new DockerCli(), new ActiveContainerRegistry(), NullLogger<ContainerRunner>.Instance,
            containerRuntime: ContainerRuntimePolicy.GvisorRuntime);
        const string source = """
            #include <errno.h>
            #include <fcntl.h>
            #include <stdio.h>
            #include <string.h>
            #include <sys/mount.h>
            #include <sys/stat.h>
            #include <unistd.h>

            int main(void) {
                int failed = 0;
                int root_readonly = 0;
                int source_readonly = 0;
                int mount_blocked = 0;
                int noexec = 0;
                int docker_socket_absent = 0;
                unsigned long long capabilities = 1;
                int no_new_privileges = 0;
                FILE *status = fopen("/proc/self/status", "r");
                char line[256];
                if (!status) return 10;
                while (fgets(line, sizeof(line), status)) {
                    if (strncmp(line, "CapEff:", 7) == 0) sscanf(line + 7, "%llx", &capabilities);
                    if (strncmp(line, "NoNewPrivs:", 11) == 0) sscanf(line + 11, "%d", &no_new_privileges);
                }
                fclose(status);
                if (getuid() != 10001 || capabilities != 0 || no_new_privileges != 1) failed = 1;

                int root_file = open("/etc/syncode-escape", O_CREAT | O_WRONLY, 0600);
                if (root_file >= 0) { close(root_file); unlink("/etc/syncode-escape"); failed = 2; }
                else root_readonly = 1;
                int source_file = open("/workspace/main.c", O_WRONLY | O_APPEND);
                if (source_file >= 0) { close(source_file); failed = 3; }
                else source_readonly = 1;
                docker_socket_absent = access("/var/run/docker.sock", F_OK) != 0;
                if (!docker_socket_absent) failed = 4;

                mkdir("/tmp/syncode-mount", 0700);
                if (mount("tmpfs", "/tmp/syncode-mount", "tmpfs", 0, NULL) == 0) {
                    umount("/tmp/syncode-mount");
                    failed = 5;
                } else if (errno == EPERM || errno == EACCES) mount_blocked = 1;
                else failed = 6;

                int script = open("/tmp/syncode-exec-check", O_CREAT | O_WRONLY | O_TRUNC, 0700);
                if (script < 0) return 11;
                write(script, "#!/bin/sh\nexit 0\n", 17);
                fchmod(script, 0700);
                close(script);
                char *arguments[] = { "/tmp/syncode-exec-check", NULL };
                execv(arguments[0], arguments);
                noexec = errno == EACCES;
                if (!noexec) failed = 7;

                printf("uid=%d capabilities=%llx no_new_privileges=%d root_readonly=%d source_readonly=%d mount_blocked=%d noexec=%d docker_socket_absent=%d\n",
                    getuid(), capabilities, no_new_privileges, root_readonly, source_readonly,
                    mount_blocked, noexec, docker_socket_absent);
                return failed;
            }
            """;

        var output = await RunAndCaptureAsync(runner, source);

        Assert.False(output.Result.TimedOut);
        Assert.Equal(0, output.Result.ExitCode);
        Assert.Contains("uid=10001 capabilities=0 no_new_privileges=1", output.Text);
        Assert.Contains("root_readonly=1 source_readonly=1 mount_blocked=1 noexec=1 docker_socket_absent=1", output.Text);
    }

    private static async Task<(ExecutionResult Result, string Text)> RunAndCaptureAsync(
        ContainerRunner runner,
        string source)
    {
        var output = new System.Text.StringBuilder();
        var result = await runner.RunAsync(
            new ExecutionJob("gvisor-adversarial", "test-room", "test-user", ExecutionLanguage.C,
                source, DateTimeOffset.UtcNow),
            chunk =>
            {
                output.Append(chunk.Text);
                return ValueTask.CompletedTask;
            });
        return (result, output.ToString());
    }
}

public sealed class GVisorIntegrationFactAttribute : FactAttribute
{
    public GVisorIntegrationFactAttribute()
    {
        if (Environment.GetEnvironmentVariable("SYNCODE_RUN_GVISOR_INTEGRATION") != "1")
            Skip = "Set SYNCODE_RUN_GVISOR_INTEGRATION=1 with Docker runsc configured to run gVisor isolation checks.";
    }
}
