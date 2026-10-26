using Syncode.ExecutionService.Runner;
using Xunit;

namespace Syncode.ExecutionService.Tests;

public sealed class ContainerRuntimePolicyTests
{
    [Fact]
    public void Resolve_UsesRuncForDevelopmentAndRunscForProduction()
    {
        Assert.Equal("runc", ContainerRuntimePolicy.Resolve(true, true, null));
        Assert.Equal("runsc", ContainerRuntimePolicy.Resolve(false, true, "runsc"));
        Assert.Equal("runc", ContainerRuntimePolicy.Resolve(false, false, null));
    }

    [Fact]
    public void Resolve_RejectsProductionWithoutGvisor()
    {
        Assert.Throws<InvalidOperationException>(() => ContainerRuntimePolicy.Resolve(false, true, null));
        Assert.Throws<InvalidOperationException>(() => ContainerRuntimePolicy.Resolve(false, true, "runc"));
    }

    [Fact]
    public void Resolve_RejectsUnknownRuntimeNames()
    {
        Assert.Throws<InvalidOperationException>(() => ContainerRuntimePolicy.Resolve(true, true, "custom;command"));
    }

    [Theory]
    [InlineData("{\"runc\":{\"path\":\"runc\"},\"runsc\":{\"path\":\"runsc\"}}", true)]
    [InlineData("{\"runc\":{\"path\":\"runc\"}}", false)]
    [InlineData("[]", false)]
    public void IsAvailable_RequiresConfiguredRuntime(string runtimes, bool expected) =>
        Assert.Equal(expected, ContainerRuntimePolicy.IsAvailable(runtimes, "runsc"));

    [Fact]
    public void DockerArgument_UsesTheValidatedRuntimeName()
    {
        Assert.Equal("--runtime=runsc", ContainerRuntimePolicy.DockerArgument("runsc"));
        Assert.Throws<ArgumentException>(() => ContainerRuntimePolicy.DockerArgument("runsc --privileged"));
    }
}
