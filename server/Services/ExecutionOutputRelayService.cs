using System.Text.Json;
using StackExchange.Redis;

namespace server.Services;

public sealed class ExecutionOutputRelayService(
    IConnectionMultiplexer redis,
    IRoomEventPublisher roomEvents,
    TerminalSessionRegistry terminalSessions,
    IConfiguration configuration,
    ServerInstanceIdentity instance,
    ILogger<ExecutionOutputRelayService> logger) : BackgroundService
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly string _queuePrefix = configuration["ExecutionService:QueuePrefix"] ?? "syncode:execution";
    private readonly string _channel = $"{configuration["ExecutionService:QueuePrefix"] ?? "syncode:execution"}:output:stream";
    private static readonly TimeSpan RelayLeaseDuration = TimeSpan.FromSeconds(20);
    private static readonly TimeSpan RelayCheckInterval = TimeSpan.FromSeconds(5);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var database = redis.GetDatabase();
        var subscriber = redis.GetSubscriber();
        var leaseKey = $"{_queuePrefix}:output:relay:leader";
        var leaseToken = $"{instance.Id}:{Guid.NewGuid():N}";
        ChannelMessageQueue? subscription = null;
        var ownsLease = false;

        try
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    if (!ownsLease)
                    {
                        ownsLease = await database.LockTakeAsync(leaseKey, leaseToken, RelayLeaseDuration);
                        if (ownsLease)
                        {
                            subscription = await subscriber.SubscribeAsync(RedisChannel.Literal(_channel));
                            subscription.OnMessage(HandleMessageAsync);
                            logger.LogInformation("This server is relaying execution output");
                        }
                    }
                    else if (!await database.LockExtendAsync(leaseKey, leaseToken, RelayLeaseDuration))
                    {
                        ownsLease = false;
                        await UnsubscribeAsync();
                        logger.LogWarning("Execution output relay lease was lost");
                    }
                }
                catch (Exception exception) when (!stoppingToken.IsCancellationRequested)
                {
                    logger.LogWarning(exception, "Could not renew the execution output relay lease");
                    if (ownsLease)
                    {
                        ownsLease = false;
                        await UnsubscribeAsync();
                    }
                }

                await Task.Delay(RelayCheckInterval, stoppingToken);
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
        finally
        {
            await UnsubscribeAsync();
            if (ownsLease)
            {
                try { await database.LockReleaseAsync(leaseKey, leaseToken); }
                catch (Exception exception) { logger.LogWarning(exception, "Could not release the execution output relay lease"); }
            }
        }

        async Task HandleMessageAsync(ChannelMessage message)
        {
            try
            {
                var executionEvent = JsonSerializer.Deserialize<ExecutionOutputMessage>(message.Message.ToString(), JsonOptions);
                if (executionEvent is null || !IsRoomId(executionEvent.RoomId)) return;

                var (eventName, payload) = executionEvent.Type switch
                {
                    "output" => ("ExecutionOutput", (object)executionEvent),
                    "completed" => ("ExecutionCompleted", (object)executionEvent),
                    "failed" => ("ExecutionFailed", (object)executionEvent),
                    _ => (string.Empty, (object)executionEvent),
                };
                if (eventName.Length == 0) return;

                await roomEvents.SendToRoomAsync(executionEvent.RoomId, eventName, payload, stoppingToken);
                if (executionEvent.Type is "completed" or "failed")
                    terminalSessions.RemoveExecution(executionEvent.JobId);
            }
            catch (Exception exception) when (!stoppingToken.IsCancellationRequested)
            {
                logger.LogWarning(exception, "Could not relay an execution event to its room");
            }
        }

        async Task UnsubscribeAsync()
        {
            if (subscription is null) return;
            try { await subscription.UnsubscribeAsync(); }
            catch (Exception exception) { logger.LogWarning(exception, "Could not unsubscribe from execution output"); }
            subscription = null;
        }
    }

    private static bool IsRoomId(string roomId) =>
        roomId.Length == 8 && roomId.All(character => character is >= 'a' and <= 'z' or >= '0' and <= '9');
}
