namespace Syncode.ExecutionService.Security;

public sealed record ResourceLimits
{
    public static ResourceLimits Default { get; } = new();

    public long MemoryBytes { get; init; } = 512L * 1024 * 1024;
    public long CSharpMemoryBytes { get; init; } = 4L * 1024 * 1024 * 1024;
    public double CpuCount { get; init; } = 1;
    public TimeSpan Timeout { get; init; } = TimeSpan.FromSeconds(30);
    public int TemporaryStorageMegabytes { get; init; } = 10;
    public int BuildStorageMegabytes { get; init; } = 128;
    public long CSharpMaxFileBytes { get; init; } = 128L * 1024 * 1024;
    public int ProcessLimit { get; init; } = 64;
    public int CSharpProcessLimit { get; init; } = 128;
    public int OpenFileLimit { get; init; } = 256;
    public int MaxSourceBytes { get; init; } = 32 * 1024 * 1024;
    public int MaxOutputBytes { get; init; } = 64 * 1024;
    public TimeSpan OrphanGracePeriod { get; init; } = TimeSpan.FromSeconds(30);
}
