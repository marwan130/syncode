using Microsoft.AspNetCore.SignalR;

namespace server.Services;

public class RoomLifecycleService : BackgroundService
{
    private readonly RedisRoomMetadataStore _rooms;
    private readonly RedisParticipantStore _participants;
    private readonly ILogger<RoomLifecycleService> _logger;
    private readonly TerminalSessionRegistry _terminalSessions;
    private readonly ExecutionServiceClient _executionService;
    private readonly TimeSpan _expiryThreshold;
    private readonly TimeSpan _cleanupInterval;

    public RoomLifecycleService(
        RedisRoomMetadataStore rooms,
        RedisParticipantStore participants,
        TerminalSessionRegistry terminalSessions,
        ExecutionServiceClient executionService,
        IConfiguration config,
        ILogger<RoomLifecycleService> logger)
    {
        _rooms = rooms;
        _participants = participants;
        _terminalSessions = terminalSessions;
        _executionService = executionService;
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
                var sessions = _terminalSessions.RemoveRoom(roomId);
                foreach (var sessionId in sessions.SessionIds)
                {
                    try { await _executionService.CloseTerminalAsync(sessionId, CancellationToken.None); }
                    catch (Exception exception) when (exception is HubException or HubOperationException) { }
                }
                foreach (var jobId in sessions.ExecutionIds)
                {
                    try { await _executionService.CancelExecutionAsync(jobId, CancellationToken.None); }
                    catch (Exception exception) when (exception is HubException or HubOperationException) { }
                }
                await _rooms.DeleteRoomAsync(roomId);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Room cleanup sweep failed");
        }
    }
}
