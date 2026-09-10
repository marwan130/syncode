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
        // send only to other people in the room so the sender does not get an echo
        await Clients.OthersInGroup(roomId).SendAsync("ReceiveEdit", fullText);
    }
    
}