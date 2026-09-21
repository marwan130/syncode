namespace server.Services;

public class RoomLifecycleService : BackgroundService
{
    private readonly RedisRoomStore _store;
    private readonly ILogger<RoomLifecycleService> _logger;
    private readonly TimeSpan _expiryThreshold;
    private readonly TimeSpan _cleanupInterval;

    public RoomLifecycleService(
        RedisRoomStore store,
        IConfiguration config,
        ILogger<RoomLifecycleService> logger)
    {
        _store = store;
        _logger = logger;

        var expiryMinutes = config.GetValue<int>("RoomExpiry:Minutes", 120);
        var intervalMinutes = config.GetValue<int>("RoomExpiry:CleanupIntervalMinutes", 5);

        _expiryThreshold = TimeSpan.FromMinutes(expiryMinutes);
        _cleanupInterval = TimeSpan.FromMinutes(intervalMinutes);

        _logger.LogInformation(
            "RoomLifecycleService started. Expiry threshold: {Threshold}m, Cleanup interval: {Interval}m",
            expiryMinutes, intervalMinutes);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            await Task.Delay(_cleanupInterval, stoppingToken);
            await RunCleanupAsync();
        }
    }

    private async Task RunCleanupAsync()
    {
        try
        {
            var stale = await _store.GetStaleRoomsAsync(_expiryThreshold);
            foreach (var roomId in stale)
            {
                await _store.DeleteRoomAsync(roomId);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error during room cleanup");
        }
    }
}
