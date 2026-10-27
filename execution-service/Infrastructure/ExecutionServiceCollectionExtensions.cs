using Microsoft.AspNetCore.Http.Json;
using StackExchange.Redis;
using Syncode.ExecutionService.Queue;
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

        var queuePrefix = configuration["ExecutionService:QueuePrefix"] ?? "syncode:execution";
        AddOutputPublisher(services, redis, queuePrefix);
        AddInteractiveTerminals(services, configuration);
        AddExecutionQueue(services, redis, configuration, queuePrefix);
        AddContainerExecution(services, configuration, runtime);
        AddWorkers(services, configuration);
        return services;
    }

    private static void AddOutputPublisher(
        IServiceCollection services,
        IConnectionMultiplexer redis,
        string queuePrefix)
    {
        var outputChannel = RedisChannel.Literal($"{queuePrefix}:output:stream");
        services.AddSingleton(sp => new ExecutionOutputPublisher(
            redis.GetSubscriber(), outputChannel, sp.GetRequiredService<ILogger<ExecutionOutputPublisher>>()));
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

    private static void AddExecutionQueue(
        IServiceCollection services,
        IConnectionMultiplexer redis,
        IConfiguration configuration,
        string queuePrefix)
    {
        services.AddSingleton(new ExecutionRateLimiter(
            redis,
            queuePrefix,
            configuration.GetValue("ExecutionService:MaxExecutionsPerRoomPerMinute", 10),
            TimeSpan.FromMinutes(configuration.GetValue("ExecutionService:ExecutionRateWindowMinutes", 1))));
        services.AddSingleton(new ExecutionJobQueue(
            redis,
            configuration.GetValue("ExecutionService:MaxPendingJobs", 50),
            queuePrefix));
    }

    private static void AddContainerExecution(
        IServiceCollection services,
        IConfiguration configuration,
        string runtime)
    {
        services.AddSingleton<ActiveContainerRegistry>();
        services.AddSingleton(ResourceLimits.Default);
        services.AddSingleton(sp => new ContainerRunner(
            sp.GetRequiredService<DockerCli>(),
            sp.GetRequiredService<ActiveContainerRegistry>(),
            sp.GetRequiredService<ILogger<ContainerRunner>>(),
            sp.GetRequiredService<ResourceLimits>(),
            runtime,
            sp.GetRequiredService<RoomDependencyStore>()));
        if (runtime == ContainerRuntimePolicy.GvisorRuntime)
            services.AddHostedService<RunscRuntimeValidator>();
        services.AddHostedService(sp => new ContainerLifecycle(
            sp.GetRequiredService<DockerCli>(),
            sp.GetRequiredService<ActiveContainerRegistry>(),
            sp.GetRequiredService<ILogger<ContainerLifecycle>>(),
            sp.GetRequiredService<ResourceLimits>()));
    }

    private static void AddWorkers(IServiceCollection services, IConfiguration configuration)
    {
        services.AddHostedService(sp => new ExecutionQueueWorker(
            sp.GetRequiredService<ExecutionJobQueue>(),
            sp.GetRequiredService<ContainerRunner>(),
            sp.GetRequiredService<ExecutionOutputPublisher>(),
            sp.GetRequiredService<ILogger<ExecutionQueueWorker>>(),
            configuration.GetValue("ExecutionService:WorkerCount", 3)));
    }
}
