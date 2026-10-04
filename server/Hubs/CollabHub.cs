using Microsoft.AspNetCore.SignalR;
using server.Models;
using server.Services;

namespace server.Hubs;

public class CollabHub : Hub
{
    private readonly RedisRoomStore _store;
    public CollabHub(RedisRoomStore store) => _store = store;

    public async Task JoinRoom(
        string roomId,
        string accessKey,
        string userId,
        string displayName,
        string color)
    {
        if (!await _store.ValidateRoomAccessAsync(roomId, accessKey))
        {
            throw new HubException("Invalid or expired room invitation.");
        }

        if (string.IsNullOrWhiteSpace(userId) || userId.Length > 128)
        {
            throw new HubException("Invalid participant identity.");
        }
        displayName = string.IsNullOrWhiteSpace(displayName)
            ? "Anonymous"
            : displayName.Trim();
        if (displayName.Length > 32)
        {
            throw new HubException("Display names must be 32 characters or fewer.");
        }
        var participantColor = color is { Length: 7 } &&
            System.Text.RegularExpressions.Regex.IsMatch(color, "^#[0-9a-fA-F]{6}$")
                ? color
                : "#38bdf8";

        if (!string.IsNullOrEmpty(userId))
        {
            var previousRoomId = await _store.GetUserRoomAsync(userId);
            if (!string.IsNullOrEmpty(previousRoomId) && previousRoomId != roomId)
            {
                var previousParticipants = await _store.GetParticipantsAsync(previousRoomId);
                foreach (var previousParticipant in previousParticipants.Where(p => p.UserId == userId))
                {
                    if (previousParticipant.ConnectionId != Context.ConnectionId)
                    {
                        await Clients.Client(previousParticipant.ConnectionId)
                            .SendAsync("PeerLeftByUser", userId, roomId);
                        await Groups.RemoveFromGroupAsync(previousParticipant.ConnectionId, previousRoomId);
                        await _store.ClearConnectionRoomAsync(previousParticipant.ConnectionId);
                    }
                }

                await _store.RemoveUserFromRoomAsync(previousRoomId, userId);
            }
            await _store.SetUserRoomAsync(userId, roomId);
        }

        var oldRoomId = await _store.GetConnectionRoomAsync(Context.ConnectionId);
        if (!string.IsNullOrEmpty(oldRoomId) && oldRoomId != roomId)
        {
            await Groups.RemoveFromGroupAsync(Context.ConnectionId, oldRoomId);
            await _store.RemoveParticipantAsync(oldRoomId, Context.ConnectionId);
            await _store.ClearConnectionRoomAsync(Context.ConnectionId);
            await Clients.OthersInGroup(oldRoomId).SendAsync("PeerLeft", Context.ConnectionId);
        }

        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        await _store.TouchRoomAsync(roomId);

        var snapshot = await _store.GetSnapshotAsync(roomId);
        if (!string.IsNullOrEmpty(snapshot))
        {
            await Clients.Caller.SendAsync("LoadSnapshot", snapshot);
        }

        var existingParticipants = await _store.GetParticipantsAsync(roomId);
        await _store.AddParticipantAsync(
            roomId,
            new Participant(Context.ConnectionId, displayName, participantColor, userId));
        await _store.SetConnectionRoomAsync(Context.ConnectionId, roomId);
        await Clients.Caller.SendAsync("RoomParticipants", existingParticipants);
        await Clients.Caller.SendAsync("ChatHistory", await _store.GetChatMessagesAsync(roomId));

        var peer = existingParticipants.FirstOrDefault(p => p.ConnectionId != Context.ConnectionId);
        if (peer != null)
        {
            await Clients.Client(peer.ConnectionId).SendAsync("RequestSnapshot", Context.ConnectionId);
        }

        await Clients.OthersInGroup(roomId)
            .SendAsync("PeerJoined", Context.ConnectionId, displayName, participantColor, userId);
    }

    public async Task SaveSnapshot(string roomId, string snapshotJson)
    {
        await EnsureParticipantAsync(roomId);
        await _store.TouchRoomAsync(roomId);
        await _store.SaveSnapshotAsync(roomId, snapshotJson);
    }

    public async Task SendSnapshotToPeer(string roomId, string targetConnectionId, string snapshotJson)
    {
        await EnsureParticipantAsync(roomId);
        if (await _store.GetConnectionRoomAsync(targetConnectionId) != roomId ||
            !await _store.IsParticipantAsync(roomId, targetConnectionId))
        {
            throw new HubException("Snapshot target is not a participant in this room.");
        }
        await _store.SaveSnapshotAsync(roomId, snapshotJson);
        await Clients.Client(targetConnectionId).SendAsync("LoadSnapshot", snapshotJson);
    }

    public async Task SendOp(string roomId, CrdtOpDto op)
    {
        await EnsureParticipantAsync(roomId);
        await _store.TouchRoomAsync(roomId);
        await Clients.OthersInGroup(roomId).SendAsync("ReceiveOp", op);
    }

    public async Task UpdateAwareness(string roomId, object awarenessState)
    {
        await EnsureParticipantAsync(roomId);
        await Clients.OthersInGroup(roomId)
            .SendAsync("AwarenessUpdate", Context.ConnectionId, awarenessState);
    }

    public async Task SendChatMessage(string roomId, string content)
    {
        await EnsureParticipantAsync(roomId);
        var normalizedContent = content?.Trim();
        if (string.IsNullOrWhiteSpace(normalizedContent)) return;
        if (normalizedContent.Length > 2000)
        {
            throw new HubException("Chat messages must be 2000 characters or fewer.");
        }

        var messageId = Guid.NewGuid().ToString("N");
        if (!await _store.TryConsumeChatRateLimitAsync(
                roomId,
                Context.ConnectionId,
                messageId))
        {
            throw new HubException("Chat rate limit reached. Please wait before sending more messages.");
        }

        var participant = await _store.GetParticipantAsync(roomId, Context.ConnectionId);
        if (participant is null) throw new HubException("Join this room before sending updates.");

        var message = new ChatMessage(
            messageId,
            participant.DisplayName,
            participant.Color,
            normalizedContent,
            DateTimeOffset.UtcNow);
        await _store.AppendChatMessageAsync(roomId, message);
        await _store.TouchRoomAsync(roomId);
        await Clients.Group(roomId).SendAsync("ChatMessage", message);
    }

    private async Task EnsureParticipantAsync(string roomId)
    {
        if (string.IsNullOrWhiteSpace(roomId) ||
            await _store.GetConnectionRoomAsync(Context.ConnectionId) != roomId ||
            !await _store.IsParticipantAsync(roomId, Context.ConnectionId))
        {
            throw new HubException("Join this room before sending updates.");
        }
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        var roomId = await _store.GetConnectionRoomAsync(Context.ConnectionId);
        if (!string.IsNullOrEmpty(roomId))
        {
            var participant = await _store.GetParticipantAsync(roomId, Context.ConnectionId);
            await _store.RemoveParticipantAsync(roomId, Context.ConnectionId);
            await _store.ClearConnectionRoomAsync(Context.ConnectionId);
            await Clients.OthersInGroup(roomId).SendAsync("PeerLeft", Context.ConnectionId);

            if (!string.IsNullOrEmpty(participant?.UserId))
            {
                var userRoom = await _store.GetUserRoomAsync(participant.UserId);
                var remaining = await _store.GetParticipantsAsync(roomId);
                if (userRoom == roomId && remaining.All(p => p.UserId != participant.UserId))
                {
                    await _store.ClearUserRoomAsync(participant.UserId);
                }
            }
        }

        await base.OnDisconnectedAsync(exception);
    }
}
