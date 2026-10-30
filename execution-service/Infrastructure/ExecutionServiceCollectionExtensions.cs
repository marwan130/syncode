using Microsoft.AspNetCore.Http.Json;
using StackExchange.Redis;
using Syncode.ExecutionService.Runner;
using Syncode.ExecutionService.Security;

namespace Syncode.ExecutionService.Infrastructure;

public static class ExecutionServiceCollectionExtensions
{
    public static IServiceCollection AddExecutionServices(
        this IServiceCollection services,
        IConnectionMultiplexer redis,
        IConfiguration configuration,
        string runtime)
    {
        services.ConfigureHttpJsonOptions(options =>
            options.SerializerOptions.Converters.Add(new System.Text.Json.Serialization.JsonStringEnumConverter()));
        services.AddSingleton<IConnectionMultiplexer>(redis);
        services.AddSingleton(PackageEgressPolicy.Resolve(
            configuration.GetValue("ExecutionService:PackageEgress:Enabled", false), runtime));
        services.AddSingleton<RoomDependencyStore>();
        services.AddSingleton(sp => new LanguageServerSessions(
            sp.GetRequiredService<RoomDependencyStore>(),
            sp.GetRequiredService<ILogger<LanguageServerSessions>>(),
            configuration,
            runtime));
        services.AddHostedService(sp => sp.GetRequiredService<LanguageServerSessions>());

        AddInteractiveTerminals(services, configuration);
        services.AddSingleton<ActiveContainerRegistry>();
        services.AddSingleton(ResourceLimits.Default);
        if (runtime == ContainerRuntimePolicy.GvisorRuntime)
            services.AddHostedService<RunscRuntimeValidator>();
        services.AddHostedService(sp => new ContainerLifecycle(
            sp.GetRequiredService<DockerCli>(),
            sp.GetRequiredService<ActiveContainerRegistry>(),
            sp.GetRequiredService<ILogger<ContainerLifecycle>>(),
            sp.GetRequiredService<ResourceLimits>()));
        return services;
    }

    private static void AddInteractiveTerminals(IServiceCollection services, IConfiguration configuration)
    {
        services.AddSingleton(new DockerCli(configuration["ExecutionService:DockerCli"] ?? "docker"));
        services.AddSingleton<IDockerCli>(sp => sp.GetRequiredService<DockerCli>());
        services.AddSingleton<PackageEgressBoundary>();
        services.AddHostedService(sp => sp.GetRequiredService<PackageEgressBoundary>());
        services.AddSingleton<InteractiveTerminalSessions>();
        services.AddHostedService(sp => sp.GetRequiredService<InteractiveTerminalSessions>());
    }

}
