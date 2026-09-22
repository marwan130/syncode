using server.Hubs;
using server.Models;
using server.Services;
using StackExchange.Redis;

var builder = WebApplication.CreateBuilder(args);

// used as both the room state store and the signalr scale-out backplane
var redisConnStr = builder.Configuration.GetValue<string>("Redis", "localhost:6379")!;
builder.Services.AddSingleton<IConnectionMultiplexer>(_ =>
    ConnectionMultiplexer.Connect(redisConnStr));

builder.Services.AddSignalR().AddStackExchangeRedis(redisConnStr);

builder.Services.AddOpenApi();
builder.Services.AddControllers();

builder.Services.AddSingleton<RedisRoomStore>();
builder.Services.AddHostedService<RoomLifecycleService>();

builder.Services.AddCors(options =>
    options.AddPolicy("dev",
        p => p.WithOrigins("http://localhost:5173")
        .AllowAnyHeader()
        .AllowAnyMethod()
        .AllowCredentials())
);

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseHttpsRedirection();
app.UseCors("dev");

app.MapControllers();
app.MapHub<CollabHub>("/collabhub");

app.Run();
