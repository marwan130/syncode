namespace Syncode.ExecutionService.Runner;

public sealed class PackageEgressPolicy
{
    public const string EgressNetwork = "syncode-package-egress";
    public const string ProxyContainer = "syncode-package-proxy";
    public const string ProxyImage = "syncode-package-proxy";

    private PackageEgressPolicy(bool enabled) => Enabled = enabled;

    public bool Enabled { get; }

    public static PackageEgressPolicy Resolve(bool enabled, string runtime)
    {
        if (enabled && runtime != ContainerRuntimePolicy.GvisorRuntime)
            throw new InvalidOperationException("Package installation requires the runsc isolation runtime.");
        return new PackageEgressPolicy(enabled);
    }

    public static string SessionNetwork(string sessionId)
    {
        if (sessionId.Length != 32 || !sessionId.All(Uri.IsHexDigit))
            throw new ArgumentException("Invalid terminal session id.", nameof(sessionId));
        return $"syncode-terminal-net-{sessionId}";
    }
}
