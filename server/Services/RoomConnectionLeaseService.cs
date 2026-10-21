namespace server.Services;

public sealed class RoomConnectionLeaseService : BackgroundService
{
    private readonly RedisParticipantStore _participants;
    private readonly ServerInstanceIdentity _instance;
    private readonly ILogger<RoomConnectionLeaseService> _logger;

    public RoomConnectionLeaseService(
        RedisParticipantStore participants,
        ServerInstanceIdentity instance,
        ILogger<RoomConnectionLeaseService> logger)
    {
        _participants = participants;
        _instance = instance;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(30));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try { await _participants.RefreshInstanceConnectionLeaseAsync(_instance.Id); }
            catch (Exception ex) when (!stoppingToken.IsCancellationRequested)
            {
                _logger.LogWarning(ex, "Could not refresh the server connection capacity lease");
            }
        }
    }
}
