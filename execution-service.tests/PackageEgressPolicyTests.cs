using Syncode.ExecutionService.Runner;
using Xunit;

namespace Syncode.ExecutionService.Tests;

public sealed class PackageEgressPolicyTests
{
    [Fact]
    public void Resolve_LeavesPackageEgressDisabledByDefault()
    {
        Assert.False(PackageEgressPolicy.Resolve(false, "runc").Enabled);
    }

    [Fact]
    public void Resolve_RequiresGvisorWhenPackageEgressIsEnabled()
    {
        Assert.Throws<InvalidOperationException>(() => PackageEgressPolicy.Resolve(true, "runc"));
        Assert.True(PackageEgressPolicy.Resolve(true, "runsc").Enabled);
    }

    [Fact]
    public void SessionNetwork_UsesOnlyValidatedSessionIdentifiers()
    {
        Assert.Equal("syncode-terminal-net-0123456789abcdef0123456789abcdef",
            PackageEgressPolicy.SessionNetwork("0123456789abcdef0123456789abcdef"));
        Assert.Throws<ArgumentException>(() => PackageEgressPolicy.SessionNetwork("../../invalid"));
    }
}
