using StackExchange.Redis;
using Syncode.ExecutionService.Api;
using Syncode.ExecutionService.Infrastructure;
using Syncode.ExecutionService.Runner;

var builder = WebApplication.CreateBuilder(args);
var executionEnabled = builder.Configuration.GetValue<bool?>("ExecutionService:Enabled") ??
    builder.Environment.IsDevelopment();
var containerRuntime = ContainerRuntimePolicy.Resolve(
    builder.Environment.IsDevelopment(), executionEnabled, builder.Configuration["ExecutionService:ContainerRuntime"]);

builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 64 * 1024 * 1024);
builder.WebHost.UseUrls(builder.Configuration["ExecutionService:Urls"] ?? "http://127.0.0.1:5112");

if (!executionEnabled)
{
    var disabledApp = ExecutionServiceStartup.BuildDisabledApp(builder);
    await disabledApp.RunAsync();
    return;
}

var apiKey = ExecutionServiceStartup.GetRequiredApiKey(builder.Configuration);
var redisConnection = ExecutionServiceStartup.GetRedisConnection(builder.Configuration, builder.Environment);

var redis = await ConnectionMultiplexer.ConnectAsync(redisConnection);
builder.Services.AddExecutionServices(redis, builder.Configuration, containerRuntime);

var app = builder.Build();
app.UseExceptionHandler(_ => { });
app.UseWebSockets();
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
