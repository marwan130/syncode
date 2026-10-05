using System.Diagnostics;
using System.Text;

namespace Syncode.ExecutionService.Runner;

public interface IDockerCli
{
    Task<int> RunStreamingAsync(IReadOnlyList<string> arguments, Func<ExecutionOutputStream, string, ValueTask> onOutput, CancellationToken cancellationToken);
    Task<string> RunTextAsync(IReadOnlyList<string> arguments, CancellationToken cancellationToken);
    Task TryRunAsync(IReadOnlyList<string> arguments, CancellationToken cancellationToken);
}

public sealed class DockerCli : IDockerCli
{
    private readonly string _executable;

    public DockerCli(string executable = "docker") => _executable = executable;

    public async Task<int> RunStreamingAsync(
        IReadOnlyList<string> arguments,
        Func<ExecutionOutputStream, string, ValueTask> onOutput,
        CancellationToken cancellationToken)
    {
        using var process = CreateProcess(arguments);
        process.Start();
        var stdoutPump = PumpOutputAsync(process.StandardOutput, ExecutionOutputStream.StandardOutput, onOutput, cancellationToken);
        var stderrPump = PumpOutputAsync(process.StandardError, ExecutionOutputStream.StandardError, onOutput, cancellationToken);
        using var registration = cancellationToken.Register(KillProcess, process);
        try
        {
            await process.WaitForExitAsync(cancellationToken);
            await Task.WhenAll(stdoutPump, stderrPump);
            return process.ExitCode;
        }
        catch (OperationCanceledException)
        {
            KillProcess(process);
            await WaitForExitAfterKillAsync(process);
            await IgnoreCancellationAsync(stdoutPump);
            await IgnoreCancellationAsync(stderrPump);
            throw;
        }
    }

    private static async Task PumpOutputAsync(
        StreamReader reader,
        ExecutionOutputStream stream,
        Func<ExecutionOutputStream, string, ValueTask> onOutput,
        CancellationToken cancellationToken)
    {
        var buffer = new char[4096];
        while (true)
        {
            var count = await reader.ReadAsync(buffer.AsMemory(), cancellationToken);
            if (count == 0)
                return;
            await onOutput(stream, new string(buffer, 0, count));
        }
    }

    private static async Task WaitForExitAfterKillAsync(Process process)
    {
        try
        {
            await process.WaitForExitAsync(CancellationToken.None);
        }
        catch (InvalidOperationException) { }
    }

    private static async Task IgnoreCancellationAsync(Task task)
    {
        try
        {
            await task;
        }
        catch (OperationCanceledException) { }
        catch (ObjectDisposedException) { }
        catch (IOException) { }
    }

    public async Task<string> RunTextAsync(IReadOnlyList<string> arguments, CancellationToken cancellationToken)
    {
        using var process = CreateProcess(arguments);
        process.Start();
        var stdoutTask = process.StandardOutput.ReadToEndAsync(cancellationToken);
        var stderrTask = process.StandardError.ReadToEndAsync(cancellationToken);
        using var registration = cancellationToken.Register(KillProcess, process);
        try
        {
            await process.WaitForExitAsync(cancellationToken);
            var stdout = await stdoutTask;
            var stderr = await stderrTask;
            if (process.ExitCode != 0)
                throw new InvalidOperationException($"Docker command failed: {stderr.Trim()}");
            return stdout;
        }
        catch (OperationCanceledException)
        {
            KillProcess(process);
            throw;
        }
    }

    public async Task TryRunAsync(IReadOnlyList<string> arguments, CancellationToken cancellationToken)
    {
        try
        {
            await RunTextAsync(arguments, cancellationToken);
        }
        catch (InvalidOperationException)
        {
        }
    }

    private Process CreateProcess(IReadOnlyList<string> arguments)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = _executable,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };

        foreach (var argument in arguments)
            startInfo.ArgumentList.Add(argument);

        return new Process { StartInfo = startInfo, EnableRaisingEvents = true };
    }

    private static void KillProcess(object? state)
    {
        if (state is Process process)
            KillProcess(process);
    }

    private static void KillProcess(Process process)
    {
        try
        {
            if (!process.HasExited)
                process.Kill(entireProcessTree: true);
        }
        catch (InvalidOperationException) { }
        catch (System.ComponentModel.Win32Exception) { }
    }
}
