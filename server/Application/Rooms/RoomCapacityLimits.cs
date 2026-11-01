namespace server.Application.Rooms;

public sealed record RoomCapacityLimits(
    int MaxParticipantsPerRoom,
    int MaxConnectionsPerInstance,
    int MaxActiveRooms);
