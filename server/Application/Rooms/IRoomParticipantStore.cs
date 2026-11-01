namespace server.Application.Rooms;

public interface IRoomParticipantStore :
    IRoomParticipantReader,
    IRoomParticipantCommands,
    IRoomParticipantAdmissionStore
{
    Task<bool> TryRegisterConnectionAsync(string connectionId, string instanceId, int maxConnections);
    Task UnregisterConnectionAsync(string connectionId, string instanceId);
    Task RefreshInstanceConnectionLeaseAsync(string instanceId);
    Task RemoveParticipantAsync(string roomId, string connectionId, string instanceId);
    Task PruneInactiveRoomsAsync();
}
