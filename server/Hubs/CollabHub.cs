using System.Collections.Concurrent;
using Microsoft.AspNetCore.SignalR;
using server.Models;

namespace server.Hubs;

public class CollabHub : Hub
{
    // tracks which room each connection is in so we can notify peers when someone disconnects
    private static readonly ConcurrentDictionary<string, string> _connectionRooms = new();

    public async Task JoinRoom(string roomId)
    {
        _connectionRooms[Context.ConnectionId] = roomId;
        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
    }

    public async Task SendEdit(string roomId, string fullText)
    {
        await Clients.OthersInGroup(roomId).SendAsync("ReceiveEdit", fullText);
    }

    public async Task SendOp(string roomId, CrdtOpDto op)
    {
        await Clients.OthersInGroup(roomId).SendAsync("ReceiveOp", op);
    }

    public async Task UpdateAwareness(string roomId, object awarenessState)
    {
        await Clients.OthersInGroup(roomId)
            .SendAsync("AwarenessUpdate", Context.ConnectionId, awarenessState);
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        if (_connectionRooms.TryRemove(Context.ConnectionId, out var roomId))
        {
            await Clients.OthersInGroup(roomId)
                .SendAsync("PeerLeft", Context.ConnectionId);
        }

        await base.OnDisconnectedAsync(exception);
    }
}
