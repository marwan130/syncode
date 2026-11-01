namespace server.Application.Rooms;

public interface IRoomParticipantAdmissionStore
{
    Task<int> TryAdmitParticipantAsync(
        string roomId,
        Participant participant,
        string instanceId,
        int maxParticipants,
        int maxActiveRooms,
        int maxConnections,
        bool isRoomCreator,
        bool isReturningMember,
        bool returningMemberIsAdmin,
        bool returningMemberIsLocked,
        bool hasReturningAdmin);

    Task<IReadOnlyList<Participant>> GetParticipantsAsync(string roomId);
}
