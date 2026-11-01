namespace server.Application.Rooms;

public interface IRoomLifecycleStore
{
    Task<IEnumerable<string>> GetStaleRoomsAsync(TimeSpan threshold);
    Task DeleteRoomAsync(string roomId);
}
