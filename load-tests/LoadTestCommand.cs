using System.Diagnostics;
using System.Text.Json;
using System.Runtime.InteropServices;
using System.Globalization;

internal static class LoadTestCommand
{
    public static async Task<int> RunAsync(string[] args)
    {
        if (args.Contains("--help", StringComparer.Ordinal) || args.Contains("-h", StringComparer.Ordinal))
        {
            Console.WriteLine("Run `dotnet run --project load-tests/Syncode.LoadTests.csproj -- --participants 2` for a safe local smoke scenario.");
            Console.WriteLine("Options include --rooms, --operations, --soak-seconds, --reconnect, --restart-checkpoint, --expiry-recovery, --execution, --execution-jobs, --worker-interruption, --docker-metrics, and --allow-remote.");
            return 0;
        }
        LoadOptions options;
        try { options = LoadOptions.Parse(args); }
        catch (ArgumentException exception)
        {
            Console.Error.WriteLine(exception.Message);
            return 2;
        }

        using var cancellation = new CancellationTokenSource();
        Console.CancelKeyPress += (_, eventArgs) =>
        {
            eventArgs.Cancel = true;
            cancellation.Cancel();
        };

        var startedAt = DateTimeOffset.UtcNow;
        using var generator = Process.GetCurrentProcess();
        var generatorSpecifications = $"{RuntimeInformation.OSDescription}; {Environment.ProcessorCount} logical CPUs; .NET {Environment.Version}; available memory {GC.GetGCMemoryInfo().TotalAvailableMemoryBytes} bytes";
        var generatorResourcesBefore = ReadGeneratorResources(generator);
        var report = await new LoadSuiteRunner(options).RunAsync(
            startedAt, generatorSpecifications, await ReadCommitAsync(), cancellation.Token);
        report.GeneratorResourcesBefore = generatorResourcesBefore;
        report.GeneratorResourcesAfter = ReadGeneratorResources(generator);
        report.CompletedAtUtc = DateTimeOffset.UtcNow;

        var json = JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true });
        Directory.CreateDirectory(options.ResultsDirectory);
        var resultPath = Path.Combine(options.ResultsDirectory, $"load-{startedAt:yyyyMMdd-HHmmss}.json");
        await File.WriteAllTextAsync(resultPath, json);
        var csvPath = Path.ChangeExtension(resultPath, ".csv");
        await File.WriteAllTextAsync(csvPath, BuildCsv(report));

        Console.WriteLine($"Scenario {report.Scenario}");
        Console.WriteLine($"Result {(report.Succeeded ? "passed" : report.Cancelled ? "cancelled" : "failed")}");
        Console.WriteLine($"Rooms {report.RoomCount}, participants {report.ParticipantCount}, operations {report.TotalOperations}, propagation p50/p95/p99 {Format(report.PropagationLatency)} ms");
        Console.WriteLine($"Connection success {report.ConnectionSuccessRate:P1}, join success {report.JoinSuccessRate:P1}, throughput {report.OperationThroughputPerSecond:F1} operations/s, soak {report.SoakDurationSeconds:F0}s");
        Console.WriteLine($"CRDT replicas converged {report.CrdtConverged}, missing deliveries {report.MissingDeliveries}, duplicate deliveries {report.DuplicateOperations}");
        Console.WriteLine($"Chat {report.ChatMessages}, presence {report.PresenceUpdates}, project-tree operations {report.ProjectTreeOperations}, room isolation {report.RoomIsolationVerified}");
        if (report.Execution is { } execution)
            Console.WriteLine($"Execution health {execution.HealthCheckMilliseconds:F2} ms, jobs {execution.CompletedJobs}/{execution.RequestedJobs}, output verified {execution.OutputVerified}, package failure handled {execution.PackageInstallFailureHandled}, sessions cleaned {execution.ContainersCleanedUp}, worker interruption {execution.WorkerInterruptionVerified}");
        if (options.CollectDockerMetrics && report.DockerMetricsAfter is null)
            Console.WriteLine("Docker metrics unavailable. Check that Docker Desktop is running and the local Compose stack exists.");
        Console.WriteLine($"Report {Path.GetFullPath(resultPath)}");
        Console.WriteLine($"CSV {Path.GetFullPath(csvPath)}");
        foreach (var error in report.Errors) Console.Error.WriteLine($"Scenario issue {error}");
        return report.Succeeded ? 0 : 1;
    }

    private static string BuildCsv(LoadReport report)
    {
        var rows = new List<string>
        {
            "roomId,participants,expectedParticipants,connectionSuccessRate,joinSuccessRate,operations,operationDeliveries,missing,duplicates,operationsPerSecond,propagationP50Ms,propagationP95Ms,propagationP99Ms,crdtConverged,snapshotPersisted,recoveryMatches,roomIsolation,chatMessages,presenceUpdates,treeOperations"
        };
        foreach (var run in report.RoomRuns.Length == 0 ? [report] : report.RoomRuns)
        {
            var latency = run.PropagationLatency;
            rows.Add(string.Join(',',
                Escape(run.RoomId),
                run.ParticipantCount.ToString(CultureInfo.InvariantCulture),
                run.ExpectedParticipantCount.ToString(CultureInfo.InvariantCulture),
                run.ConnectionSuccessRate.ToString("F4", CultureInfo.InvariantCulture),
                run.JoinSuccessRate.ToString("F4", CultureInfo.InvariantCulture),
                run.TotalOperations.ToString(CultureInfo.InvariantCulture),
                run.ObservedOperationDeliveries.ToString(CultureInfo.InvariantCulture),
                run.MissingDeliveries.ToString(CultureInfo.InvariantCulture),
                run.DuplicateOperations.ToString(CultureInfo.InvariantCulture),
                run.OperationThroughputPerSecond.ToString("F2", CultureInfo.InvariantCulture),
                Number(latency?.P50), Number(latency?.P95), Number(latency?.P99),
                run.CrdtConverged?.ToString() ?? string.Empty,
                run.SnapshotPersisted?.ToString() ?? string.Empty,
                run.RecoveredSnapshotMatches?.ToString() ?? string.Empty,
                run.RoomIsolationVerified?.ToString() ?? string.Empty,
                run.ChatMessages.ToString(CultureInfo.InvariantCulture),
                run.PresenceUpdates.ToString(CultureInfo.InvariantCulture),
                run.ProjectTreeOperations.ToString(CultureInfo.InvariantCulture)));
        }
        return string.Join(Environment.NewLine, rows) + Environment.NewLine;
    }

    private static string Number(double? value) => value?.ToString("F2", CultureInfo.InvariantCulture) ?? string.Empty;
    private static string Escape(string? value) => $"\"{(value ?? string.Empty).Replace("\"", "\"\"", StringComparison.Ordinal)}\"";

    private static string ReadGeneratorResources(Process process)
    {
        process.Refresh();
        return $"workingSetBytes={process.WorkingSet64}; privateBytes={process.PrivateMemorySize64}; cpuTimeMs={process.TotalProcessorTime.TotalMilliseconds:F0}; gcHeapBytes={GC.GetTotalMemory(false)}";
    }

    private static string Format(LatencySummary? summary) => summary is null
        ? "unavailable"
        : $"{summary.P50:F2}/{summary.P95:F2}/{summary.P99:F2}";

    private static async Task<string?> ReadCommitAsync()
    {
        try
        {
            using var process = Process.Start(new ProcessStartInfo("git", "rev-parse HEAD")
            {
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false
            });
            if (process is null) return null;
            var commit = await process.StandardOutput.ReadToEndAsync();
            await process.WaitForExitAsync();
            return process.ExitCode == 0 ? commit.Trim() : null;
        }
        catch { return null; }
    }
}
