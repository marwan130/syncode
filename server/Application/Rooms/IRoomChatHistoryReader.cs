namespace server.Application.Rooms;

public interface IRoomChatHistoryReader
{
    Task<IReadOnlyList<ChatMessage>> GetMessagesAsync(string roomId);
}
