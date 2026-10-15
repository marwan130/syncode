namespace server.Services;

public sealed class RoomConnectionLeaseService : BackgroundService
{
    private readonly RedisRoomStore _store;
    private readonly ServerInstanceIdentity _instance;
    private readonly ILogger<RoomConnectionLeaseService> _logger;

    public RoomConnectionLeaseService(
        RedisRoomStore store,
        ServerInstanceIdentity instance,
        ILogger<RoomConnectionLeaseService> logger)
    {
        _store = store;
        _instance = instance;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(30));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try { await _store.RefreshInstanceConnectionLeaseAsync(_instance.Id); }
            catch (Exception ex) when (!stoppingToken.IsCancellationRequested)
            {
                _logger.LogWarning(ex, "Could not refresh the server connection capacity lease");
            }
        }
    }
}
