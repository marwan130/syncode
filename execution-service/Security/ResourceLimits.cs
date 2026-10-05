namespace Syncode.ExecutionService.Security;

public sealed record ResourceLimits
{
    public static ResourceLimits Default { get; } = new();

    public long MemoryBytes { get; init; } = 128L * 1024 * 1024;
    public double CpuCount { get; init; } = 0.5;
    public TimeSpan Timeout { get; init; } = TimeSpan.FromSeconds(10);
    public int TemporaryStorageMegabytes { get; init; } = 10;
    public int ProcessLimit { get; init; } = 64;
    public int MaxSourceBytes { get; init; } = 64 * 1024;
    public int MaxOutputBytes { get; init; } = 64 * 1024;
    public TimeSpan OrphanGracePeriod { get; init; } = TimeSpan.FromSeconds(30);
}
