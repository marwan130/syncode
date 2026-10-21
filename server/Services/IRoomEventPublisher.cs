namespace server.Services;

public interface IRoomEventPublisher
{
    Task SendToRoomAsync(string roomId, string eventName, object payload, CancellationToken cancellationToken);
}
