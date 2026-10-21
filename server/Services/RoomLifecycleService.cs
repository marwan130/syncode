namespace server.Services;

public class RoomLifecycleService : BackgroundService
{
    private readonly RedisRoomMetadataStore _rooms;
    private readonly RedisParticipantStore _participants;
    private readonly ILogger<RoomLifecycleService> _logger;
    private readonly TimeSpan _expiryThreshold;
    private readonly TimeSpan _cleanupInterval;

    public RoomLifecycleService(
        RedisRoomMetadataStore rooms,
        RedisParticipantStore participants,
        IConfiguration config,
        ILogger<RoomLifecycleService> logger)
    {
        _rooms = rooms;
        _participants = participants;
        _logger = logger;

        var expiryMinutes = config.GetValue<int>("RoomExpiry:Minutes", 120);
        var intervalMinutes = config.GetValue<int>("RoomExpiry:CleanupIntervalMinutes", 5);

        _expiryThreshold = TimeSpan.FromMinutes(expiryMinutes);
        _cleanupInterval = TimeSpan.FromMinutes(intervalMinutes);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await RunCleanupAsync();
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
            await _participants.PruneInactiveRoomsAsync();
            var stale = await _rooms.GetStaleRoomsAsync(_expiryThreshold);
            foreach (var roomId in stale)
            {
                await _rooms.DeleteRoomAsync(roomId);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Room cleanup sweep failed");
        }
    }
}
