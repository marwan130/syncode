using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Http.Json;
using StackExchange.Redis;
using Syncode.ExecutionService.Queue;
using Syncode.ExecutionService.Runner;
using Syncode.ExecutionService.Security;

var builder = WebApplication.CreateBuilder(args);
var apiKey = builder.Configuration["ExecutionService:ApiKey"] ?? Environment.GetEnvironmentVariable("SYNCODE_EXECUTION_API_KEY");
if (string.IsNullOrWhiteSpace(apiKey))
    throw new InvalidOperationException("Set ExecutionService:ApiKey or SYNCODE_EXECUTION_API_KEY before starting the execution service.");
if (Encoding.UTF8.GetByteCount(apiKey) < 32)
    throw new InvalidOperationException("The execution-service API key must be at least 32 bytes long.");

var redisConnection = builder.Configuration["Redis"] ?? Environment.GetEnvironmentVariable("Redis") ?? "localhost:6379";
var redis = await ConnectionMultiplexer.ConnectAsync(redisConnection);
builder.Services.ConfigureHttpJsonOptions(options => options.SerializerOptions.Converters.Add(new System.Text.Json.Serialization.JsonStringEnumConverter()));
builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 128 * 1024);
builder.WebHost.UseUrls(builder.Configuration["ExecutionService:Urls"] ?? "http://127.0.0.1:5112");
builder.Services.AddSingleton<IConnectionMultiplexer>(redis);
builder.Services.AddSingleton(new DockerCli(builder.Configuration["ExecutionService:DockerCli"] ?? "docker"));
builder.Services.AddSingleton<IDockerCli>(sp => sp.GetRequiredService<DockerCli>());
builder.Services.AddSingleton<ActiveContainerRegistry>();
builder.Services.AddSingleton(ResourceLimits.Default);
builder.Services.AddSingleton(sp => new ExecutionJobQueue(
    sp.GetRequiredService<IConnectionMultiplexer>(),
    builder.Configuration.GetValue("ExecutionService:MaxPendingJobs", 50)));
builder.Services.AddSingleton(sp => new ContainerRunner(
    sp.GetRequiredService<DockerCli>(),
    sp.GetRequiredService<ActiveContainerRegistry>(),
    sp.GetRequiredService<ILogger<ContainerRunner>>(),
    sp.GetRequiredService<ResourceLimits>()));
builder.Services.AddHostedService(sp => new ContainerLifecycle(
    sp.GetRequiredService<DockerCli>(),
    sp.GetRequiredService<ActiveContainerRegistry>(),
    sp.GetRequiredService<ILogger<ContainerLifecycle>>(),
    sp.GetRequiredService<ResourceLimits>()));
builder.Services.AddHostedService(sp => new ExecutionQueueWorker(
    sp.GetRequiredService<ExecutionJobQueue>(),
    sp.GetRequiredService<ContainerRunner>(),
    sp.GetRequiredService<ILogger<ExecutionQueueWorker>>(),
    builder.Configuration.GetValue("ExecutionService:WorkerCount", 3)));

var app = builder.Build();
app.MapGet("/health", () => Results.Ok(new { status = "healthy" }));
app.MapPost("/api/executions", async (HttpContext context, QueueExecutionRequest request, ExecutionJobQueue queue, CancellationToken cancellationToken) =>
{
    if (!HasValidApiKey(context, apiKey))
        return Results.Unauthorized();

    if (string.IsNullOrWhiteSpace(request.RoomId) || request.RoomId.Length > 128 ||
        string.IsNullOrWhiteSpace(request.RequestedBy) || request.RequestedBy.Length > 128 ||
        request.Source is null || Encoding.UTF8.GetByteCount(request.Source) > ResourceLimits.Default.MaxSourceBytes ||
        !Enum.IsDefined(request.Language))
        return Results.BadRequest(new { error = "Invalid execution request." });

    var job = new ExecutionJob(
        Guid.NewGuid().ToString("N"), request.RoomId, request.RequestedBy, request.Language,
        request.Source, DateTimeOffset.UtcNow);
    var position = await queue.EnqueueAsync(job, cancellationToken);
    return position is null
        ? Results.Problem("The execution queue is full. Try again shortly.", statusCode: StatusCodes.Status503ServiceUnavailable)
        : Results.Accepted($"/api/executions/{job.Id}", new { jobId = job.Id, queuePosition = position });
});
app.MapGet("/api/executions/{jobId}", async (HttpContext context, string jobId, ExecutionJobQueue queue, CancellationToken cancellationToken) =>
{
    if (!HasValidApiKey(context, apiKey))
        return Results.Unauthorized();

    if (jobId.Length != 32 || !jobId.All(Uri.IsHexDigit))
        return Results.BadRequest(new { error = "Invalid execution id." });

    var status = await queue.GetStatusAsync(jobId, cancellationToken);
    return status is null ? Results.NotFound() : Results.Ok(status);
});

try
{
    await app.RunAsync();
}
finally
{
    await redis.CloseAsync();
}

static bool HasValidApiKey(HttpContext context, string expected)
{
    if (!context.Request.Headers.TryGetValue("X-Execution-Service-Key", out var supplied))
        return false;

    var expectedBytes = Encoding.UTF8.GetBytes(expected);
    var suppliedBytes = Encoding.UTF8.GetBytes(supplied.ToString());
    return suppliedBytes.Length == expectedBytes.Length && CryptographicOperations.FixedTimeEquals(suppliedBytes, expectedBytes);
}

public sealed record QueueExecutionRequest(
    string RoomId,
    string RequestedBy,
    ExecutionLanguage Language,
    string Source);
