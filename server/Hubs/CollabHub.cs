using Microsoft.AspNetCore.SignalR;

namespace server.Hubs;

public class CollabHub : Hub
{
    public async Task JoinRoom(string roomId)
    {
        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
    }

    public async Task SendEdit(string roomId, string fullText)
    {
        await Clients.OthersInGroup(roomId).SendAsync("ReceiveEdit", fullText);
    }
}
