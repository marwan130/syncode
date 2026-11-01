using System.Diagnostics;
using System.Text;

namespace Syncode.ExecutionService.Runner;

public interface IDockerCli
{
    Task<int> RunStreamingAsync(string executionId, IReadOnlyList<string> arguments, Func<ExecutionOutputStream, string, ValueTask> onOutput, CancellationToken cancellationToken);
    Task WriteExecutionInputAsync(string executionId, string input, CancellationToken cancellationToken);
    Task<string> RunTextAsync(IReadOnlyList<string> arguments, CancellationToken cancellationToken);
    Task TryRunAsync(IReadOnlyList<string> arguments, CancellationToken cancellationToken);
}

public sealed class ExecutionInputBufferLimitException : Exception
{
    public ExecutionInputBufferLimitException() : base() { }

    public ExecutionInputBufferLimitException(string message) : base(message) { }

    public ExecutionInputBufferLimitException(string message, Exception innerException)
        : base(message, innerException) { }
}

public sealed class DockerCli : IDockerCli
{
    private readonly string _executable;
    private readonly System.Collections.Concurrent.ConcurrentDictionary<string, InteractiveInput> _interactiveProcesses = new(StringComparer.Ordinal);

    public DockerCli(string executable = "docker") => _executable = executable;

    public async Task<int> RunStreamingAsync(
        string executionId,
        IReadOnlyList<string> arguments,
        Func<ExecutionOutputStream, string, ValueTask> onOutput,
        CancellationToken cancellationToken)
    {
        using var process = CreateProcess(arguments, redirectInput: true);
        process.Start();
        var input = _interactiveProcesses.GetOrAdd(executionId, static _ => new InteractiveInput());
        lock (input.Gate)
        {
            if (input.Process is not null)
            {
                KillProcess(process);
                throw new InvalidOperationException("An execution with this id is already running.");
            }
            input.Process = process;
            while (input.Pending.TryDequeue(out var pending))
            {
                input.PendingCharacters -= pending.Length;
                process.StandardInput.Write(pending);
            }
            process.StandardInput.Flush();
        }
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
        finally
        {
            lock (input.Gate) input.Process = null;
            if (_interactiveProcesses.TryGetValue(executionId, out var current) && ReferenceEquals(input, current))
                _interactiveProcesses.TryRemove(executionId, out _);
        }
    }

    public Task WriteExecutionInputAsync(string executionId, string input, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var session = _interactiveProcesses.GetOrAdd(executionId, static _ => new InteractiveInput());
        lock (session.Gate)
        {
            if (session.Process is null)
            {
                if (session.PendingCharacters + input.Length > 8192)
                    throw new ExecutionInputBufferLimitException();
                session.Pending.Enqueue(input);
                session.PendingCharacters += input.Length;
            }
            else
            {
                if (session.Process.HasExited) throw new KeyNotFoundException("This execution is no longer accepting input.");
                session.Process.StandardInput.Write(input);
                session.Process.StandardInput.Flush();
            }
        }
        return Task.CompletedTask;
    }

    private sealed class InteractiveInput
    {
        public object Gate { get; } = new();
        public Process? Process { get; set; }
        public Queue<string> Pending { get; } = new();
        public int PendingCharacters { get; set; }
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
            _ = await stderrTask;
            if (process.ExitCode != 0)
                throw new InvalidOperationException("Docker command failed.");
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

    private Process CreateProcess(IReadOnlyList<string> arguments, bool redirectInput = false)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = _executable,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            RedirectStandardInput = redirectInput,
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
