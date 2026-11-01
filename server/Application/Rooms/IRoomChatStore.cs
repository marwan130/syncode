namespace server.Application.Rooms;

public interface IRoomChatStore
{
    Task AppendMessageAsync(string roomId, ChatMessage message);
}
