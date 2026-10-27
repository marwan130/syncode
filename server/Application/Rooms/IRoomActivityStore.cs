namespace server.Application.Rooms;

public interface IRoomActivityStore
{
    Task TouchRoomAsync(string roomId);
}
