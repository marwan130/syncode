internal sealed class LoadReport
{
    private int _totalOperations;

    public string Scenario { get; init; } = "single-room-crdt-relay";
    public string BaseUrl { get; init; } = string.Empty;
    public string Environment { get; init; } = string.Empty;
    public string ServerSpecifications { get; init; } = string.Empty;
    public string GeneratorSpecifications { get; init; } = string.Empty;
    public string? GeneratorResourcesBefore { get; set; }
    public string? GeneratorResourcesAfter { get; set; }
    public string? Commit { get; init; }
    public DateTimeOffset StartedAtUtc { get; init; }
    public DateTimeOffset CompletedAtUtc { get; set; }
    public string? RoomId { get; set; }
    public int ParticipantCount { get; set; }
    public int ExpectedParticipantCount { get; set; }
    public double ConnectionSuccessRate { get; set; }
    public double JoinSuccessRate { get; set; }
    public double DurationSeconds { get; set; }
    public double? HealthCheckMilliseconds { get; set; }
    public double? RoomCreationMilliseconds { get; set; }
    public double? EditPropagationMilliseconds { get; set; }
    public double SoakDurationSeconds { get; set; }
    public List<double> ConnectionLatenciesMilliseconds { get; } = [];
    public List<double> JoinLatenciesMilliseconds { get; } = [];
    public List<double> PropagationLatenciesMilliseconds { get; } = [];
    public int TotalOperations => Volatile.Read(ref _totalOperations);
    public int ExpectedOperationDeliveries { get; set; }
    public int ObservedOperationDeliveries { get; set; }
    public int MissingDeliveries { get; set; }
    public int DuplicateOperations { get; set; }
    public int DuplicateRoomEvents { get; set; }
    public double OperationThroughputPerSecond { get; set; }
    public LatencySummary? PropagationLatency { get; set; }
    public LatencySummary? ConnectionLatency { get; set; }
    public LatencySummary? JoinLatency { get; set; }
    public bool? CrdtConverged { get; set; }
    public bool? SnapshotPersisted { get; set; }
    public double? ReconnectMilliseconds { get; set; }
    public double? RoomExpiryWaitSeconds { get; set; }
    public bool? RecoveredSnapshotMatches { get; set; }
    public bool? RoomExpiryRecoveryVerified { get; set; }
    public bool Cancelled { get; set; }
    public bool Succeeded { get; set; }
    public string[] Errors { get; set; } = [];
    public int RoomCount { get; set; } = 1;
    public LoadReport[] RoomRuns { get; set; } = [];
    public int ChatMessages { get; set; }
    public int PresenceUpdates { get; set; }
    public int ProjectTreeOperations { get; set; }
    public bool? RoomIsolationVerified { get; set; }
    public string? DockerMetricsBefore { get; set; }
    public string? DockerMetricsAfter { get; set; }
    public string[] DockerMetricsSamples { get; set; } = [];
    public ExecutionLoadResult? Execution { get; set; }

    public void IncrementOperations() => Interlocked.Increment(ref _totalOperations);
    public void AddOperations(int count) => Interlocked.Add(ref _totalOperations, count);
}

internal sealed record ExecutionLoadResult(
    int RequestedJobs,
    int CompletedJobs,
    double HealthCheckMilliseconds,
    double StartLatencyP95Milliseconds,
    double RunRequestLatencyP95Milliseconds,
    double TotalDurationSeconds,
    bool OutputVerified,
    bool ContainersCleanedUp,
    bool PackageInstallFailureHandled,
    bool WorkerInterruptionVerified,
    string[] Errors);

internal sealed record LatencySummary(double P50, double P95, double P99)
{
    public static LatencySummary? From(IEnumerable<double> values)
    {
        var ordered = values.Order().ToArray();
        if (ordered.Length == 0) return null;
        double Percentile(double percentile) => ordered[Math.Clamp((int)Math.Ceiling(percentile * ordered.Length) - 1, 0, ordered.Length - 1)];
        return new LatencySummary(Percentile(.50), Percentile(.95), Percentile(.99));
    }
}
