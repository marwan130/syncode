using System.Text.Json;

namespace Syncode.ExecutionService.Runner;

public static class ContainerRuntimePolicy
{
    public const string GvisorRuntime = "runsc";

    public static string Resolve(bool isDevelopment, bool executionEnabled, string? configuredRuntime)
    {
        if (!executionEnabled) return "runc";

        var runtime = string.IsNullOrWhiteSpace(configuredRuntime)
            ? isDevelopment ? "runc" : null
            : configuredRuntime.Trim();

        if (runtime is not ("runc" or GvisorRuntime))
            throw new InvalidOperationException("ExecutionService:ContainerRuntime must be runc or runsc.");
        if (!isDevelopment && runtime != GvisorRuntime)
            throw new InvalidOperationException("Production code execution requires the runsc isolation runtime.");

        return runtime;
    }

    public static string DockerArgument(string runtime) =>
        $"--runtime={ValidateName(runtime)}";

    public static bool IsAvailable(string runtimesJson, string runtime)
    {
        using var document = JsonDocument.Parse(runtimesJson);
        return document.RootElement.ValueKind == JsonValueKind.Object &&
            document.RootElement.TryGetProperty(ValidateName(runtime), out _);
    }

    private static string ValidateName(string runtime) => runtime is "runc" or GvisorRuntime
        ? runtime
        : throw new ArgumentException("Unsupported container runtime.", nameof(runtime));
}
