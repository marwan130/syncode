using server.Hubs;
using server.Models;
using server.Services;
using Microsoft.AspNetCore.SignalR;
using StackExchange.Redis;

var builder = WebApplication.CreateBuilder(args);

if (builder.Environment.IsDevelopment())
{
    var envFile = Path.Combine(builder.Environment.ContentRootPath, ".env");
    if (!File.Exists(envFile))
        envFile = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", ".env"));
    if (File.Exists(envFile))
    {
        foreach (var line in File.ReadLines(envFile))
        {
            var valueLine = line.Trim();
            if (valueLine.Length == 0 || valueLine.StartsWith('#')) continue;
            var separator = valueLine.IndexOf('=');
            if (separator < 1) continue;

            var key = valueLine[..separator].Trim();
            var value = valueLine[(separator + 1)..].Trim();
            if (value.Length >= 2 &&
                (value[0] == '"' && value[^1] == '"' || value[0] == '\'' && value[^1] == '\''))
                value = value[1..^1];

            var configurationKey = key.Replace("__", ":", StringComparison.Ordinal);
            if (string.IsNullOrWhiteSpace(builder.Configuration[configurationKey]))
                builder.Configuration[configurationKey] = value;
        }
    }
}

// Redis stores room state and provides the SignalR scale-out backplane.
var redisConnStr = builder.Configuration["Redis"];
if (string.IsNullOrWhiteSpace(redisConnStr))
{
    if (!builder.Environment.IsDevelopment())
        throw new InvalidOperationException("Configure Redis before starting Syncode outside Development.");
    redisConnStr = "localhost:6379";
}
builder.Services.AddSingleton<IConnectionMultiplexer>(_ =>
    ConnectionMultiplexer.Connect(redisConnStr));

builder.Services.AddSignalR(options =>
    {
        options.MaximumReceiveMessageSize = 16 * 1024 * 1024;
        options.AddFilter<HubOperationExceptionFilter>();
    })
    .AddStackExchangeRedis(redisConnStr);

builder.Services.AddOpenApi();
builder.Services.AddControllers();
builder.Services.AddHttpClient("GithubOAuth", client => client.Timeout = TimeSpan.FromSeconds(15));

builder.Services.AddSingleton<RedisFileStore>();
builder.Services.AddSingleton<RedisParticipantStore>();
builder.Services.AddSingleton<RedisRoomJoinApprovalStore>();
builder.Services.AddSingleton<RedisProjectTreeStore>();
builder.Services.AddSingleton<RedisRoomMetadataStore>();
builder.Services.AddSingleton<RedisRoomChatStore>();
builder.Services.AddSingleton<RedisRoomRateLimitStore>();
builder.Services.AddSingleton<ProjectTreeStateService>();
builder.Services.AddSingleton<RoomWorkspaceAdapter>();
builder.Services.AddSingleton<ProjectTreeOperationService>();
builder.Services.AddSingleton<ProjectImportService>();
builder.Services.AddSingleton<GithubRepositoryStore>();
builder.Services.AddSingleton<GithubRepositoryAccessStore>();
builder.Services.AddSingleton<GithubApiClient>();
builder.Services.AddSingleton<GithubRepositoryService>();
builder.Services.AddSingleton<RoomJoinService>();
builder.Services.AddSingleton<RoomAuthorizationService>();
builder.Services.AddSingleton<RoomFileService>();
builder.Services.AddSingleton<TerminalSessionService>();
builder.Services.AddSingleton<RoomInteractionService>();
builder.Services.AddSingleton<CollabHubServices>();
builder.Services.AddSingleton<IRoomEventPublisher, SignalRRoomEventPublisher>();
builder.Services.AddSingleton<GithubTokenVault>();
builder.Services.AddSingleton<GithubOAuthService>();
builder.Services.AddOptions<RoomCapacityOptions>()
    .Bind(builder.Configuration.GetSection(RoomCapacityOptions.SectionName))
    .Validate(options => options.MaxParticipantsPerRoom > 0 &&
        options.MaxConnectionsPerInstance > 0 && options.MaxActiveRooms > 0,
        "Room capacity limits must all be positive numbers.");
builder.Services.AddSingleton<ServerInstanceIdentity>();
builder.Services.AddHostedService<RoomConnectionLeaseService>();
builder.Services.AddSingleton<TerminalSessionRegistry>();
builder.Services.AddHostedService<RoomLifecycleService>();
builder.Services.AddHttpClient<ExecutionServiceClient>(client =>
    client.Timeout = TimeSpan.FromSeconds(15));
builder.Services.AddHostedService<ExecutionOutputRelayService>();

var allowedOrigins = AllowedOriginsConfiguration.Resolve(builder.Configuration, builder.Environment);
ProductionConfigurationValidator.ValidateGithub(
    builder.Configuration,
    builder.Environment,
    allowedOrigins);
builder.Services.AddCors(options => options.AddPolicy("client", policy =>
    policy.WithOrigins(allowedOrigins).AllowAnyHeader().AllowAnyMethod().AllowCredentials()));

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseExceptionHandler(_ => { });
app.UseHttpsRedirection();
app.UseCors("client");

app.MapControllers();
app.MapHub<CollabHub>("/collabhub");

app.Run();
