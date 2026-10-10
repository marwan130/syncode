using System.Text.Json;
using Microsoft.AspNetCore.SignalR;
using server.Hubs;
using StackExchange.Redis;

namespace server.Services;

public sealed class ExecutionOutputRelayService(
    IConnectionMultiplexer redis,
    IHubContext<CollabHub> hub,
    IConfiguration configuration,
    ILogger<ExecutionOutputRelayService> logger) : BackgroundService
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly string _channel =
        $"{configuration["ExecutionService:QueuePrefix"] ?? "syncode:execution"}:output:stream";

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var subscription = await redis.GetSubscriber().SubscribeAsync(RedisChannel.Literal(_channel));
        subscription.OnMessage(async message =>
        {
            try
            {
                var executionEvent = JsonSerializer.Deserialize<ExecutionOutputEvent>(message.Message.ToString(), JsonOptions);
                if (executionEvent is null || !IsRoomId(executionEvent.RoomId)) return;

                var (eventName, payload) = executionEvent.Type switch
                {
                    "output" => ("ExecutionOutput", (object)executionEvent),
                    "completed" => ("ExecutionCompleted", (object)executionEvent),
                    "failed" => ("ExecutionFailed", (object)executionEvent),
                    _ => (string.Empty, (object)executionEvent),
                };
                if (eventName.Length > 0)
                {
                    await hub.Clients.Group(executionEvent.RoomId)
                        .SendAsync(eventName, payload, stoppingToken);
                }
            }
            catch (Exception exception)
            {
                logger.LogWarning(exception, "Could not relay an execution event to its room");
            }
        });

        try
        {
            await Task.Delay(Timeout.InfiniteTimeSpan, stoppingToken);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
        finally
        {
            await subscription.UnsubscribeAsync();
        }
    }

    private static bool IsRoomId(string roomId) =>
        roomId.Length == 8 && roomId.All(character => character is >= 'a' and <= 'z' or >= '0' and <= '9');
}
