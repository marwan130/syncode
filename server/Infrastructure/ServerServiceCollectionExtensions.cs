using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Options;
using server.Application.Execution;
using server.Application.Github;
using server.Application.Projects;
using server.Application.Rooms;
using server.Hubs;
using server.Models;
using server.Services;
using StackExchange.Redis;

namespace server.Infrastructure;

public static class ServerServiceCollectionExtensions
{
    public static IServiceCollection AddSyncodeServerServices(
        this IServiceCollection services,
        IConfiguration configuration,
        IWebHostEnvironment environment)
    {
        TrustedProxyConfiguration.Configure(services, configuration);
        var redisConnection = configuration["Redis"];
        if (string.IsNullOrWhiteSpace(redisConnection))
        {
            if (!environment.IsDevelopment())
                throw new InvalidOperationException("Configure Redis before starting Syncode outside Development.");
            redisConnection = "localhost:6379";
        }

        services.AddSingleton<IConnectionMultiplexer>(_ => ConnectionMultiplexer.Connect(redisConnection));
        services.AddSignalR(options =>
            {
                options.MaximumReceiveMessageSize = 16 * 1024 * 1024;
                options.AddFilter<HubOperationExceptionFilter>();
            })
            .AddStackExchangeRedis(redisConnection);
        services.AddAuthentication();
        services.AddControllers();
        services.AddOpenApi();
        services.AddHttpClient("GithubOAuth", client => client.Timeout = TimeSpan.FromSeconds(15));

        AddRoomServices(services);
        AddProjectTreeServices(services);
        services.AddSingleton<IRoomCreationStore>(provider =>
            provider.GetRequiredService<RedisRoomMetadataStore>());
        services.AddSingleton<CreateRoomService>();
        AddGithubServices(services);
        AddExecutionServices(services);
        AddBackgroundServices(services);
        AddCapacityOptions(services, configuration);

        var allowedOrigins = AllowedOriginsConfiguration.Resolve(configuration, environment);
        ProductionConfigurationValidator.ValidateGithub(configuration, environment, allowedOrigins);
        services.AddCors(options => options.AddPolicy("client", policy =>
            policy.WithOrigins(allowedOrigins).AllowAnyHeader().AllowAnyMethod().AllowCredentials()));

        return services;
    }

    public static IApplicationBuilder UseTrustedProxyForwarding(this IApplicationBuilder app) =>
        app.UseForwardedHeaders();

    private static void AddRoomServices(IServiceCollection services)
    {
        services.AddSingleton<RedisFileStore>();
        services.AddSingleton<RedisRoomJoinApprovalStore>();
        services.AddSingleton<IRoomParticipantStore, RedisParticipantStore>();
        services.AddSingleton<IRoomJoinApprovalStore>(provider =>
            provider.GetRequiredService<RedisRoomJoinApprovalStore>());
        services.AddSingleton<RedisProjectTreeStore>();
        services.AddSingleton<RedisRoomMetadataStore>();
        services.AddSingleton<RedisRoomChatStore>();
        services.AddSingleton<RedisRoomRateLimitStore>();
        services.AddSingleton<IGithubAuthRateLimiter>(provider =>
            provider.GetRequiredService<RedisRoomRateLimitStore>());
        services.AddSingleton<ProjectImportService>();
        services.AddSingleton<RoomInteractionService>();
        services.AddSingleton<IRoomParticipantCommands>(provider =>
            provider.GetRequiredService<IRoomParticipantStore>());
        services.AddSingleton<IRoomParticipantAdmissionStore>(provider =>
            provider.GetRequiredService<IRoomParticipantStore>());
        services.AddSingleton<IRoomChatStore>(provider =>
            provider.GetRequiredService<RedisRoomChatStore>());
        services.AddSingleton<IRoomChatHistoryReader>(provider =>
            provider.GetRequiredService<RedisRoomChatStore>());
        services.AddSingleton<IRoomInvitationStore>(provider =>
            provider.GetRequiredService<RedisRoomMetadataStore>());
        services.AddSingleton<IRoomLifecycleStore>(provider =>
            provider.GetRequiredService<RedisRoomMetadataStore>());
        services.AddSingleton<IRoomRateLimiter>(provider =>
            provider.GetRequiredService<RedisRoomRateLimitStore>());
        services.AddSingleton<IRoomCreationRateLimiter>(provider =>
            provider.GetRequiredService<RedisRoomRateLimitStore>());
        services.AddSingleton<IRoomActivityStore>(provider =>
            provider.GetRequiredService<RedisRoomMetadataStore>());
        services.AddSingleton<IRoomRecoveryStore>(provider =>
            provider.GetRequiredService<RedisRoomMetadataStore>());
        services.AddSingleton<RoomCapacityLimits>(provider =>
        {
            var configuredLimits = provider.GetRequiredService<IOptions<RoomCapacityOptions>>().Value;
            return new RoomCapacityLimits(
                configuredLimits.MaxParticipantsPerRoom,
                configuredLimits.MaxConnectionsPerInstance,
                configuredLimits.MaxActiveRooms);
        });
        services.AddSingleton<RoomJoinService>();
        services.AddSingleton<RoomAuthorizationService>();
        services.AddSingleton<RoomFileService>();
        services.AddSingleton<IRoomEventPublisher, SignalRRoomEventPublisher>();
    }

    private static void AddProjectTreeServices(IServiceCollection services)
    {
        services.AddSingleton<IProjectEntryStore>(provider =>
            provider.GetRequiredService<RedisFileStore>());
        services.AddSingleton<IProjectSnapshotWriter>(provider =>
            provider.GetRequiredService<RedisFileStore>());
        services.AddSingleton<IProjectSnapshotReader>(provider =>
            provider.GetRequiredService<RedisFileStore>());
        services.AddSingleton<IRoomParticipantReader>(provider =>
            provider.GetRequiredService<IRoomParticipantStore>());
        services.AddSingleton<IProjectTreeOperationStore>(provider =>
            provider.GetRequiredService<RedisProjectTreeStore>());
        services.AddSingleton<IProjectTreeRateLimiter>(provider =>
            provider.GetRequiredService<RedisRoomRateLimitStore>());
        services.AddSingleton<IProjectImportRateLimiter>(provider =>
            provider.GetRequiredService<RedisRoomRateLimitStore>());
        services.AddSingleton<IProjectImportQuotaStore>(provider =>
            provider.GetRequiredService<RedisRoomMetadataStore>());
        services.AddSingleton<IProjectImportBaselineStore>(provider =>
            provider.GetRequiredService<GithubRepositoryStore>());
        services.AddSingleton<IProjectRootNameStore>(provider =>
            provider.GetRequiredService<RedisRoomMetadataStore>());
        services.AddSingleton<IProjectTreeStateReader, ProjectTreeStateService>();
        services.AddSingleton<ProjectTreeOperationService>();
        services.AddSingleton<RoomWorkspaceAdapter>();
    }

    private static void AddGithubServices(IServiceCollection services)
    {
        services.AddSingleton<GithubRepositoryStore>();
        services.AddSingleton<GithubRepositoryAccessStore>();
        services.AddSingleton<GithubApiClient>();
        services.AddSingleton<GithubRepositoryImportService>();
        services.AddSingleton<GithubRepositoryPushService>();
        services.AddSingleton<GithubRepositoryBrowserService>();
        services.AddSingleton<GithubTokenVault>();
        services.AddSingleton<GithubOAuthService>();
    }

    private static void AddExecutionServices(IServiceCollection services)
    {
        services.AddSingleton<TerminalSessionService>();
        services.AddSingleton<LanguageServerSessionService>();
        services.AddSingleton<TerminalSessionRegistry>();
        services.AddSingleton<ITerminalSessionRegistry>(provider =>
            provider.GetRequiredService<TerminalSessionRegistry>());
        services.AddHttpClient<ExecutionServiceClient>(client =>
            client.Timeout = TimeSpan.FromSeconds(90));
        services.AddSingleton<IExecutionGateway>(provider =>
            provider.GetRequiredService<ExecutionServiceClient>());
    }

    private static void AddBackgroundServices(IServiceCollection services)
    {
        services.AddSingleton<ServerInstanceIdentity>();
        services.AddHostedService<RoomConnectionLeaseService>();
        services.AddHostedService<RoomLifecycleService>();
    }

    private static void AddCapacityOptions(IServiceCollection services, IConfiguration configuration) =>
        services.AddOptions<RoomCapacityOptions>()
            .Bind(configuration.GetSection(RoomCapacityOptions.SectionName))
            .Validate(options => options.MaxParticipantsPerRoom > 0 &&
                options.MaxConnectionsPerInstance > 0 && options.MaxActiveRooms > 0,
                "Room capacity limits must all be positive numbers.");
}
