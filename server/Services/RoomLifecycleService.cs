using Microsoft.AspNetCore.SignalR;
using server.Application.Rooms;
using server.Hubs;

namespace server.Services;

public class RoomLifecycleService : BackgroundService
{
    private readonly IRoomLifecycleStore _rooms;
    private readonly IRoomRecoveryStore _roomRecovery;
    private readonly IRoomParticipantStore _participants;
    private readonly ILogger<RoomLifecycleService> _logger;
    private readonly TerminalSessionRegistry _terminalSessions;
    private readonly ExecutionServiceClient _executionService;
    private readonly IHubContext<CollabHub> _hubContext;
    private readonly TimeSpan _expiryThreshold;
    private readonly TimeSpan _cleanupInterval;

    public RoomLifecycleService(
        IRoomLifecycleStore rooms,
        IRoomRecoveryStore roomRecovery,
        IRoomParticipantStore participants,
        TerminalSessionRegistry terminalSessions,
        ExecutionServiceClient executionService,
        IHubContext<CollabHub> hubContext,
        IConfiguration config,
        ILogger<RoomLifecycleService> logger)
    {
        _rooms = rooms;
        _roomRecovery = roomRecovery;
        _participants = participants;
        _terminalSessions = terminalSessions;
        _executionService = executionService;
        _hubContext = hubContext;
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
                try { await _hubContext.Clients.Group(roomId).SendAsync("RoomExpired"); }
                catch (Exception exception)
                {
                    _logger.LogWarning(exception, "Could not notify room clients before cleanup");
                }
                var participants = await _participants.GetParticipantsAsync(roomId);
                foreach (var participant in participants)
                    await _participants.RemoveParticipantAsync(
                        roomId, participant.ConnectionId, participant.InstanceId);
                var sessions = _terminalSessions.RemoveRoom(roomId);
                foreach (var sessionId in sessions)
                {
                    try { await _executionService.CloseTerminalAsync(sessionId, CancellationToken.None); }
                    catch (Exception exception) when (exception is HubException or RoomOperationException) { }
                }
                try { await _executionService.DeleteRoomDependenciesAsync(roomId, CancellationToken.None); }
                catch (Exception exception) when (exception is HubException or RoomOperationException) { }
                await _roomRecovery.ArchiveExpiredRoomAsync(roomId);
                await _rooms.DeleteRoomAsync(roomId);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Room cleanup sweep failed");
        }
    }
}
