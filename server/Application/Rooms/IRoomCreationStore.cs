namespace server.Application.Rooms;

public interface IRoomCreationStore
{
    Task CreateRoomAsync(string roomId, string accessKeyHash, string creatorTokenHash);
}
