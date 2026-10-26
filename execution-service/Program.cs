using System.Text;
using Microsoft.AspNetCore.Http.Json;
using StackExchange.Redis;
using Syncode.ExecutionService.Api;
using Syncode.ExecutionService.Queue;
using Syncode.ExecutionService.Runner;
using Syncode.ExecutionService.Security;

var builder = WebApplication.CreateBuilder(args);
var executionEnabled = builder.Configuration.GetValue<bool?>("ExecutionService:Enabled") ??
    builder.Environment.IsDevelopment();
var containerRuntime = ContainerRuntimePolicy.Resolve(
    builder.Environment.IsDevelopment(), executionEnabled, builder.Configuration["ExecutionService:ContainerRuntime"]);

builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 64 * 1024 * 1024);
builder.WebHost.UseUrls(builder.Configuration["ExecutionService:Urls"] ?? "http://127.0.0.1:5112");

if (!executionEnabled)
{
    var disabledApp = builder.Build();
    disabledApp.MapGet("/health", () => Results.Problem(
        "Execution is disabled until a hardened worker runtime is configured.",
        statusCode: StatusCodes.Status503ServiceUnavailable));
    disabledApp.MapMethods("/api/{**path}", ["GET", "POST", "PUT", "PATCH", "DELETE"], () => Results.Problem(
        "Execution is disabled until a hardened worker runtime is configured.",
        statusCode: StatusCodes.Status503ServiceUnavailable));
    await disabledApp.RunAsync();
    return;
}

var apiKey = builder.Configuration["ExecutionService:ApiKey"] ??
    Environment.GetEnvironmentVariable("SYNCODE_EXECUTION_API_KEY");
if (string.IsNullOrWhiteSpace(apiKey))
    throw new InvalidOperationException("Set ExecutionService:ApiKey or SYNCODE_EXECUTION_API_KEY before starting the execution service.");
if (Encoding.UTF8.GetByteCount(apiKey) < 32)
    throw new InvalidOperationException("The execution-service API key must be at least 32 bytes long.");

var redisConnection = builder.Configuration["Redis"] ?? Environment.GetEnvironmentVariable("Redis");
if (string.IsNullOrWhiteSpace(redisConnection))
{
    if (!builder.Environment.IsDevelopment())
        throw new InvalidOperationException("Configure Redis before starting the execution service outside Development.");
    redisConnection = "localhost:6379";
}

var redis = await ConnectionMultiplexer.ConnectAsync(redisConnection);
builder.Services.ConfigureHttpJsonOptions(options =>
    options.SerializerOptions.Converters.Add(new System.Text.Json.Serialization.JsonStringEnumConverter()));
builder.Services.AddSingleton<IConnectionMultiplexer>(redis);

var queuePrefix = builder.Configuration["ExecutionService:QueuePrefix"] ?? "syncode:execution";
var outputChannel = RedisChannel.Literal($"{queuePrefix}:output:stream");
builder.Services.AddSingleton(sp => new ExecutionOutputPublisher(
    redis.GetSubscriber(), outputChannel, sp.GetRequiredService<ILogger<ExecutionOutputPublisher>>()));
builder.Services.AddSingleton(sp => new ExecutionRateLimiter(
    sp.GetRequiredService<IConnectionMultiplexer>(), queuePrefix,
    builder.Configuration.GetValue("ExecutionService:MaxExecutionsPerRoomPerMinute", 10),
    TimeSpan.FromMinutes(builder.Configuration.GetValue("ExecutionService:ExecutionRateWindowMinutes", 1))));
builder.Services.AddSingleton(new DockerCli(builder.Configuration["ExecutionService:DockerCli"] ?? "docker"));
builder.Services.AddSingleton<IDockerCli>(sp => sp.GetRequiredService<DockerCli>());
builder.Services.AddSingleton<ActiveContainerRegistry>();
builder.Services.AddSingleton<InteractiveTerminalSessions>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<InteractiveTerminalSessions>());
builder.Services.AddSingleton(ResourceLimits.Default);
builder.Services.AddSingleton(sp => new ExecutionJobQueue(
    sp.GetRequiredService<IConnectionMultiplexer>(),
    builder.Configuration.GetValue("ExecutionService:MaxPendingJobs", 50), queuePrefix));
builder.Services.AddSingleton(sp => new ContainerRunner(
    sp.GetRequiredService<DockerCli>(), sp.GetRequiredService<ActiveContainerRegistry>(),
    sp.GetRequiredService<ILogger<ContainerRunner>>(), sp.GetRequiredService<ResourceLimits>(), containerRuntime));
if (containerRuntime == ContainerRuntimePolicy.GvisorRuntime)
    builder.Services.AddHostedService<RunscRuntimeValidator>();
builder.Services.AddHostedService(sp => new ContainerLifecycle(
    sp.GetRequiredService<DockerCli>(), sp.GetRequiredService<ActiveContainerRegistry>(),
    sp.GetRequiredService<ILogger<ContainerLifecycle>>(), sp.GetRequiredService<ResourceLimits>()));
builder.Services.AddHostedService(sp => new ExecutionQueueWorker(
    sp.GetRequiredService<ExecutionJobQueue>(), sp.GetRequiredService<ContainerRunner>(),
    sp.GetRequiredService<ExecutionOutputPublisher>(), sp.GetRequiredService<ILogger<ExecutionQueueWorker>>(),
    builder.Configuration.GetValue("ExecutionService:WorkerCount", 3)));

var app = builder.Build();
app.UseExceptionHandler(_ => { });
app.MapGet("/health", () => Results.Ok(new { status = "healthy" }));
ExecutionEndpoints.Map(app, apiKey);

try
{
    await app.RunAsync();
}
finally
{
    await redis.CloseAsync();
}
