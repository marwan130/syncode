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

        var files = await _store.GetEntriesAsync(roomId);
        await Clients.Caller.SendAsync("RoomFiles", files);
        foreach (var file in files.Where(entry => !entry.IsFolder))
        {
            var fileSnapshot = await _store.GetFileSnapshotAsync(roomId, file.Id);
            if (string.IsNullOrEmpty(fileSnapshot) && file.Id == "main.cpp")
            {
                fileSnapshot = await _store.GetSnapshotAsync(roomId);
                if (!string.IsNullOrEmpty(fileSnapshot))
                    await _store.SaveFileSnapshotAsync(roomId, file.Id, fileSnapshot);
            }
            if (!string.IsNullOrEmpty(fileSnapshot))
                await Clients.Caller.SendAsync("LoadFileSnapshot", file.Id, fileSnapshot);
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
            foreach (var file in files)
                await Clients.Client(peer.ConnectionId).SendAsync("RequestFileSnapshot", file.Id, Context.ConnectionId);

        await Clients.OthersInGroup(roomId)
            .SendAsync("PeerJoined", Context.ConnectionId, displayName, participantColor, userId);
    }

    public async Task SaveFileSnapshot(string roomId, string fileId, string snapshotJson)
    {
        await EnsureFileParticipantAsync(roomId, fileId);
        if (string.IsNullOrEmpty(snapshotJson) || snapshotJson.Length > 5_000_000)
            throw new HubException("Invalid file snapshot.");
        await _store.TouchRoomAsync(roomId);
        await _store.SaveFileSnapshotAsync(roomId, fileId, snapshotJson);
    }

    public async Task SendFileSnapshotToPeer(string roomId, string fileId, string targetConnectionId, string snapshotJson)
    {
        await EnsureFileParticipantAsync(roomId, fileId);
        if (string.IsNullOrEmpty(snapshotJson) || snapshotJson.Length > 5_000_000)
            return;
        if (await _store.GetConnectionRoomAsync(targetConnectionId) != roomId ||
            !await _store.IsParticipantAsync(roomId, targetConnectionId))
        {
            return;
        }
        await _store.SaveFileSnapshotAsync(roomId, fileId, snapshotJson);
        await Clients.Client(targetConnectionId).SendAsync("LoadFileSnapshot", fileId, snapshotJson);
    }

    public async Task SendFileOp(string roomId, string fileId, CrdtOpDto op)
    {
        await EnsureFileParticipantAsync(roomId, fileId);
        await _store.TouchRoomAsync(roomId);
        await Clients.OthersInGroup(roomId).SendAsync("ReceiveFileOp", fileId, op);
    }

    public async Task<string> CreateEntry(string roomId, string name, string? parentId, bool isFolder)
    {
        await EnsureParticipantAsync(roomId);
        name = ValidateFileName(name);
        var entries = await _store.GetEntriesAsync(roomId);
        if (entries.Count >= 500) throw new HubException("A room can contain up to 500 files and folders.");
        ValidateParent(entries, parentId);
        var entry = new RedisRoomStore.RoomEntry(Guid.NewGuid().ToString("N"), name, parentId, isFolder);
        if (!await _store.CreateEntryAsync(roomId, entry))
            throw new HubException("An item with that name already exists in this folder.");
        await Clients.Group(roomId).SendAsync("FileAdded", entry);
        return entry.Id;
    }

    public async Task RenameEntry(string roomId, string entryId, string name)
    {
        await EnsureEntryParticipantAsync(roomId, entryId);
        name = ValidateFileName(name);
        if (!await _store.RenameEntryAsync(roomId, entryId, name))
            throw new HubException("An item with that name already exists in this folder.");
        await Clients.Group(roomId).SendAsync("FileRenamed", entryId, name);
    }

    public async Task DeleteEntry(string roomId, string entryId)
    {
        await EnsureEntryParticipantAsync(roomId, entryId);
        var result = await _store.DeleteEntryAsync(roomId, entryId);
        if (result.Status == -1) throw new HubException("A room must keep at least one file.");
        if (result.Status == 0) throw new HubException("File or folder no longer exists.");
        await Clients.Group(roomId).SendAsync("FileDeleted", result.DeletedIds);
    }

    private async Task EnsureFileParticipantAsync(string roomId, string fileId)
    {
        await EnsureParticipantAsync(roomId);
        if (!(await _store.GetEntriesAsync(roomId)).Any(entry => entry.Id == fileId && !entry.IsFolder))
            throw new HubException("File no longer exists.");
    }

    private async Task EnsureEntryParticipantAsync(string roomId, string entryId)
    {
        await EnsureParticipantAsync(roomId);
        if (!(await _store.GetEntriesAsync(roomId)).Any(entry => entry.Id == entryId))
            throw new HubException("File or folder no longer exists.");
    }

    private static void ValidateParent(IReadOnlyList<RedisRoomStore.RoomEntry> entries, string? parentId)
    {
        if (parentId is null) return;
        var parent = entries.FirstOrDefault(entry => entry.Id == parentId && entry.IsFolder)
            ?? throw new HubException("Parent folder no longer exists.");
        var depth = 1;
        while (parent.ParentId is not null)
        {
            parent = entries.FirstOrDefault(entry => entry.Id == parent.ParentId && entry.IsFolder)
                ?? throw new HubException("Invalid folder hierarchy.");
            if (++depth >= 16) throw new HubException("Folders can be nested up to 16 levels.");
        }
    }

    private static string ValidateFileName(string name)
    {
        name = name?.Trim() ?? string.Empty;
        if (name.Length is < 1 or > 128 || name is "." or ".." ||
            name.IndexOfAny([ '/', '\\', ':', '*', '?', '"', '<', '>', '|' ]) >= 0 ||
            name.Any(char.IsControl))
            throw new HubException("Enter a valid file name (up to 128 characters).");
        return name;
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
