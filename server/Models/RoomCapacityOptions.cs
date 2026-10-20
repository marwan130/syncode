namespace server.Models;

public sealed class RoomCapacityOptions
{
    internal const string SectionName = "RoomCapacity";

    public int MaxParticipantsPerRoom { get; set; } = 6;
    public int MaxConnectionsPerInstance { get; set; } = 50;
    public int MaxActiveRooms { get; set; } = 10;
}
