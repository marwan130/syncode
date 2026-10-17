using server.Hubs;
using server.Config;
using server.Models;
using server.Services;
using StackExchange.Redis;

var builder = WebApplication.CreateBuilder(args);

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

builder.Services.AddSignalR(options => options.MaximumReceiveMessageSize = 6 * 1024 * 1024)
    .AddStackExchangeRedis(redisConnStr);

builder.Services.AddOpenApi();
builder.Services.AddControllers();

builder.Services.AddSingleton<RedisRoomStore>();
builder.Services.AddOptions<AiProviderOptions>()
    .Bind(builder.Configuration.GetSection(AiProviderOptions.SectionName))
    .Validate(options => !options.Enabled ||
        (!string.IsNullOrWhiteSpace(options.Provider) &&
         new[] { "openai-compatible", "anthropic" }.Contains(options.Provider, StringComparer.OrdinalIgnoreCase) &&
         !string.IsNullOrWhiteSpace(options.Model) &&
         !string.IsNullOrWhiteSpace(options.ApiKey) &&
         options.MaxRequestCharacters > 0 &&
         options.MaxResponseCharacters > 0 &&
         options.RequestsPerMinutePerConnection > 0 &&
         options.RequestsPerMinutePerRoom > 0 &&
         options.DailyUsageBudget > 0),
        "Enabled AI provider settings must be complete and have positive limits.");
builder.Services.AddSingleton<AiProviderClient>();
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

var allowedOrigins = builder.Configuration.GetSection("AllowedOrigins").Get<string[]>();
if (allowedOrigins is not { Length: > 0 })
{
    if (!builder.Environment.IsDevelopment())
        throw new InvalidOperationException("Configure AllowedOrigins before starting Syncode outside Development.");
    allowedOrigins = ["http://localhost:5173"];
}
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
