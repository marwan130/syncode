using System.Collections.Concurrent;
using Microsoft.AspNetCore.SignalR;
using server.Models;
using server.Services;

namespace server.Hubs;

public class CollabHub : Hub
{
    private readonly RedisRoomStore _store;
    private static readonly ConcurrentDictionary<string, string> _connectionRooms = new();
    private static readonly ConcurrentDictionary<string, string> _connectionUsers = new();

    public CollabHub(RedisRoomStore store) => _store = store;

    public async Task JoinRoom(string roomId, string userId, string displayName, string color)
    {

        if (!string.IsNullOrEmpty(userId))
        {
            var previousRoomId = await _store.GetUserRoomAsync(userId);
            if (!string.IsNullOrEmpty(previousRoomId) && previousRoomId != roomId)
            {
                await _store.RemoveUserFromRoomAsync(previousRoomId, userId);
                await Clients.Group(previousRoomId).SendAsync("PeerLeftByUser", userId, roomId);

                foreach (var (connId, uId) in _connectionUsers)
                {
                    if (uId == userId && connId != Context.ConnectionId)
                    {
                        if (_connectionRooms.TryGetValue(connId, out var rId) && rId == previousRoomId)
                        {
                            await Groups.RemoveFromGroupAsync(connId, previousRoomId);
                            _connectionRooms.TryRemove(connId, out _);
                        }
                    }
                }
            }
            await _store.SetUserRoomAsync(userId, roomId);
            _connectionUsers[Context.ConnectionId] = userId;
        }

        if (_connectionRooms.TryRemove(Context.ConnectionId, out var oldRoomId) && oldRoomId != roomId)
        {
            await Groups.RemoveFromGroupAsync(Context.ConnectionId, oldRoomId);
            await _store.RemoveParticipantAsync(oldRoomId, Context.ConnectionId);
            await Clients.OthersInGroup(oldRoomId).SendAsync("PeerLeft", Context.ConnectionId);
        }

        _connectionRooms[Context.ConnectionId] = roomId;
        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        await _store.TouchRoomAsync(roomId);

        var snapshot = await _store.GetSnapshotAsync(roomId);
        if (!string.IsNullOrEmpty(snapshot))
        {
            await Clients.Caller.SendAsync("LoadSnapshot", snapshot);
        }

        var existingParticipants = await _store.GetParticipantsAsync(roomId);
        await Clients.Caller.SendAsync("RoomParticipants", existingParticipants);

        var peer = existingParticipants.FirstOrDefault(p => p.ConnectionId != Context.ConnectionId);
        if (peer != null)
        {
            await Clients.Client(peer.ConnectionId).SendAsync("RequestSnapshot", Context.ConnectionId);
        }

        await _store.AddParticipantAsync(roomId, new Participant(Context.ConnectionId, displayName, color, userId));
        await Clients.OthersInGroup(roomId).SendAsync("PeerJoined", Context.ConnectionId, displayName, color, userId);
    }

    public async Task SaveSnapshot(string roomId, string snapshotJson)
    {
        await _store.TouchRoomAsync(roomId);
        await _store.SaveSnapshotAsync(roomId, snapshotJson);
    }

    public async Task SendSnapshotToPeer(string roomId, string targetConnectionId, string snapshotJson)
    {
        await _store.SaveSnapshotAsync(roomId, snapshotJson);
        await Clients.Client(targetConnectionId).SendAsync("LoadSnapshot", snapshotJson);
    }

    public async Task SendOp(string roomId, CrdtOpDto op)
    {
        await _store.TouchRoomAsync(roomId);
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
            await _store.RemoveParticipantAsync(roomId, Context.ConnectionId);
            await Clients.OthersInGroup(roomId).SendAsync("PeerLeft", Context.ConnectionId);
        }

        if (_connectionUsers.TryRemove(Context.ConnectionId, out var userId))
        {
            var userRoom = await _store.GetUserRoomAsync(userId);
            if (userRoom == roomId)
            {
                await _store.ClearUserRoomAsync(userId);
            }
        }

        await base.OnDisconnectedAsync(exception);
    }
}
