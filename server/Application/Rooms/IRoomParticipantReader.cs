namespace server.Application.Rooms;

public interface IRoomParticipantReader
{
    Task<Participant?> GetParticipantAsync(string roomId, string connectionId);
    Task<bool> IsParticipantAsync(string roomId, string connectionId);
    Task<string?> GetConnectionRoomAsync(string connectionId);
}
