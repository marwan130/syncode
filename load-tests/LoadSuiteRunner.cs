using System.Diagnostics;
using System.Collections.Concurrent;

internal sealed class LoadSuiteRunner(LoadOptions options)
{
    public async Task<LoadReport> RunAsync(
        DateTimeOffset startedAt,
        string generatorSpecifications,
        string? commit,
        CancellationToken cancellationToken)
    {
        var metricsBefore = options.CollectDockerMetrics ? await ReadDockerMetricsAsync(cancellationToken) : null;
        using var metricCancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var metricSamples = new ConcurrentQueue<string>();
        var samplingTask = options.CollectDockerMetrics
            ? SampleDockerMetricsAsync(metricSamples, metricCancellation.Token)
            : Task.CompletedTask;
        var runs = (await Task.WhenAll(Enumerable.Range(1, options.Rooms).Select(async roomIndex =>
        {
            try
            {
                if (roomIndex > 1)
                    await Task.Delay(TimeSpan.FromMilliseconds(2100L * (roomIndex - 1)), cancellationToken);
                return await new SignalRLoadScenario(options, roomIndex).RunAsync(
                    startedAt, generatorSpecifications, commit, cancellationToken);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                return null;
            }
        }))).Where(run => run is not null).Cast<LoadReport>().ToArray();
        var report = Combine(runs, startedAt, generatorSpecifications, commit);
        report.DockerMetricsBefore = metricsBefore;
        if (options.RunExecution && !cancellationToken.IsCancellationRequested)
        {
            try { report.Execution = await new ExecutionLoadScenario(options).RunAsync(cancellationToken); }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { report.Cancelled = true; }
        }
        metricCancellation.Cancel();
        await samplingTask;
        report.DockerMetricsSamples = metricSamples.ToArray();
        report.DockerMetricsAfter = options.CollectDockerMetrics ? await ReadDockerMetricsAsync(cancellationToken) : null;
        report.Cancelled = cancellationToken.IsCancellationRequested || runs.Any(run => run.Cancelled);
        report.Succeeded = !report.Cancelled && runs.Length == options.Rooms && runs.All(run => run.Succeeded) &&
            (!options.RunExecution || report.Execution is { OutputVerified: true, ContainersCleanedUp: true, PackageInstallFailureHandled: true, CompletedJobs: var jobs } && jobs == options.ExecutionJobs) &&
            (!options.WorkerInterruptionCheckpoint || report.Execution?.WorkerInterruptionVerified == true);
        return report;
    }

    private static async Task SampleDockerMetricsAsync(ConcurrentQueue<string> samples, CancellationToken cancellationToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(5));
        try
        {
            while (await timer.WaitForNextTickAsync(cancellationToken))
            {
                if (samples.Count >= 100) continue;
                var sample = await ReadDockerMetricsAsync(cancellationToken);
                if (sample is not null) samples.Enqueue($"{DateTimeOffset.UtcNow:O}{Environment.NewLine}{sample}");
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { }
    }

    private LoadReport Combine(LoadReport[] runs, DateTimeOffset startedAt, string generatorSpecifications, string? commit)
    {
        if (runs.Length == 0)
            return new LoadReport
            {
                BaseUrl = options.BaseUrl.ToString(),
                Environment = options.Environment,
                ServerSpecifications = options.ServerSpecifications,
                GeneratorSpecifications = generatorSpecifications,
                Commit = commit,
                StartedAtUtc = startedAt,
                CompletedAtUtc = DateTimeOffset.UtcNow,
                RoomCount = 0,
                Cancelled = true
            };
        var report = new LoadReport
        {
            Scenario = runs.Length == 1 ? runs[0].Scenario : "multi-room-collaboration",
            BaseUrl = options.BaseUrl.ToString(),
            Environment = options.Environment,
            ServerSpecifications = options.ServerSpecifications,
            GeneratorSpecifications = generatorSpecifications,
            Commit = commit,
            StartedAtUtc = startedAt,
            CompletedAtUtc = DateTimeOffset.UtcNow,
            DurationSeconds = runs.Max(run => run.DurationSeconds),
            RoomCount = runs.Length,
            RoomRuns = runs,
            ParticipantCount = runs.Sum(run => run.ParticipantCount),
            ExpectedParticipantCount = runs.Sum(run => run.ExpectedParticipantCount),
            ConnectionSuccessRate = runs.Sum(run => run.ConnectionLatenciesMilliseconds.Count) /
                (double)Math.Max(runs.Sum(run => run.ExpectedParticipantCount), 1),
            JoinSuccessRate = runs.Sum(run => run.JoinSuccessRate * run.ExpectedParticipantCount) /
                Math.Max(runs.Sum(run => run.ExpectedParticipantCount), 1),
            HealthCheckMilliseconds = runs.Average(run => run.HealthCheckMilliseconds ?? 0),
            RoomCreationMilliseconds = runs.Average(run => run.RoomCreationMilliseconds ?? 0),
            EditPropagationMilliseconds = runs.Max(run => run.EditPropagationMilliseconds ?? 0),
            ExpectedOperationDeliveries = runs.Sum(run => run.ExpectedOperationDeliveries),
            ObservedOperationDeliveries = runs.Sum(run => run.ObservedOperationDeliveries),
            MissingDeliveries = runs.Sum(run => run.MissingDeliveries),
            DuplicateOperations = runs.Sum(run => run.DuplicateOperations),
            DuplicateRoomEvents = runs.Sum(run => run.DuplicateRoomEvents),
            OperationThroughputPerSecond = runs.Sum(run => run.OperationThroughputPerSecond),
            CrdtConverged = runs.All(run => run.CrdtConverged == true),
            SnapshotPersisted = runs.All(run => run.SnapshotPersisted == true),
            ReconnectMilliseconds = runs.Where(run => run.ReconnectMilliseconds is not null).Select(run => run.ReconnectMilliseconds).DefaultIfEmpty().Max(),
            RoomExpiryWaitSeconds = runs.Where(run => run.RoomExpiryWaitSeconds is not null).Select(run => run.RoomExpiryWaitSeconds).DefaultIfEmpty().Max(),
            RecoveredSnapshotMatches = runs.Any(run => run.RecoveredSnapshotMatches is not null)
                ? runs.All(run => run.RecoveredSnapshotMatches == true)
                : null,
            RoomExpiryRecoveryVerified = runs.Any(run => run.RoomExpiryRecoveryVerified is not null)
                ? runs.All(run => run.RoomExpiryRecoveryVerified == true)
                : null,
            RoomIsolationVerified = runs.All(run => run.RoomIsolationVerified == true),
            ChatMessages = runs.Sum(run => run.ChatMessages),
            PresenceUpdates = runs.Sum(run => run.PresenceUpdates),
            ProjectTreeOperations = runs.Sum(run => run.ProjectTreeOperations),
            SoakDurationSeconds = runs.Max(run => run.SoakDurationSeconds),
            Errors = runs.SelectMany(run => run.Errors).ToArray(),
            Cancelled = runs.Any(run => run.Cancelled)
        };
        foreach (var run in runs)
        {
            report.AddOperations(run.TotalOperations);
            report.ConnectionLatenciesMilliseconds.AddRange(run.ConnectionLatenciesMilliseconds);
            report.JoinLatenciesMilliseconds.AddRange(run.JoinLatenciesMilliseconds);
            report.PropagationLatenciesMilliseconds.AddRange(run.PropagationLatenciesMilliseconds);
        }
        report.ConnectionLatency = LatencySummary.From(report.ConnectionLatenciesMilliseconds);
        report.JoinLatency = LatencySummary.From(report.JoinLatenciesMilliseconds);
        report.PropagationLatency = LatencySummary.From(report.PropagationLatenciesMilliseconds);
        return report;
    }

    private static async Task<string?> ReadDockerMetricsAsync(CancellationToken cancellationToken)
    {
        var ids = await RunProcessAsync("docker", [
            "compose", "--env-file", "infra/.env", "-f", "infra/docker-compose.local.yml", "ps", "-q"], cancellationToken);
        if (ids.ExitCode != 0 || string.IsNullOrWhiteSpace(ids.Output)) return null;
        var arguments = new List<string> { "stats", "--no-stream", "--format", "{{.Name}} cpu={{.CPUPerc}} memory={{.MemUsage}} network={{.NetIO}} block={{.BlockIO}}" };
        arguments.AddRange(ids.Output.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));
        var stats = await RunProcessAsync("docker", arguments, cancellationToken);
        if (stats.ExitCode != 0) return null;
        var redisMemory = await RunProcessAsync("docker", [
            "compose", "--env-file", "infra/.env", "-f", "infra/docker-compose.local.yml", "exec", "-T", "redis", "redis-cli", "INFO", "memory"], cancellationToken);
        var redisCommands = await RunProcessAsync("docker", [
            "compose", "--env-file", "infra/.env", "-f", "infra/docker-compose.local.yml", "exec", "-T", "redis", "redis-cli", "INFO", "commandstats"], cancellationToken);
        return $"Containers{Environment.NewLine}{stats.Output.Trim()}{Environment.NewLine}Redis memory{Environment.NewLine}{redisMemory.Output.Trim()}{Environment.NewLine}Redis commandstats{Environment.NewLine}{redisCommands.Output.Trim()}";
    }

    private static async Task<(int ExitCode, string Output)> RunProcessAsync(
        string executable,
        IEnumerable<string> arguments,
        CancellationToken cancellationToken)
    {
        using var process = new Process
        {
            StartInfo = new ProcessStartInfo(executable)
            {
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            }
        };
        foreach (var argument in arguments) process.StartInfo.ArgumentList.Add(argument);
        try
        {
            if (!process.Start()) return (-1, string.Empty);
            var outputTask = process.StandardOutput.ReadToEndAsync(cancellationToken);
            await process.WaitForExitAsync(cancellationToken);
            return (process.ExitCode, await outputTask);
        }
        catch (Exception exception) when (exception is InvalidOperationException or System.ComponentModel.Win32Exception or OperationCanceledException)
        {
            return (-1, string.Empty);
        }
    }
}
