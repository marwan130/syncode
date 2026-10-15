using Microsoft.AspNetCore.SignalR;
using System.Text;
using server.Models;
using server.Services;
using Microsoft.Extensions.Options;

namespace server.Hubs;

public class CollabHub : Hub
{
    private readonly RedisRoomStore _store;
    private readonly ExecutionServiceClient _executionService;
    private readonly TerminalSessionRegistry _terminalSessions;
    private readonly RoomCapacityOptions _roomLimits;
    private readonly string _instanceId;
    public CollabHub(
        RedisRoomStore store,
        ExecutionServiceClient executionService,
        TerminalSessionRegistry terminalSessions,
        IOptions<RoomCapacityOptions> roomLimits,
        ServerInstanceIdentity instanceIdentity)
    {
        _store = store;
        _executionService = executionService;
        _terminalSessions = terminalSessions;
        _roomLimits = roomLimits.Value;
        _instanceId = instanceIdentity.Id;
    }

    public async Task<TerminalSessionStartResult> StartTerminal()
    {
        var roomId = await _store.GetConnectionRoomAsync(Context.ConnectionId);
        if (string.IsNullOrEmpty(roomId)) throw new HubException("Join a room before opening a terminal.");
        await EnsureParticipantAsync(roomId);
        var session = await _executionService.StartTerminalAsync(Context.ConnectionAborted);
        if (_terminalSessions.TryAdd(Context.ConnectionId, roomId, session.SessionId)) return session;
        await _executionService.CloseTerminalAsync(session.SessionId, Context.ConnectionAborted);
        throw new HubException("You can have up to three terminal tabs open at once.");
    }

    public async Task WriteTerminalInput(string sessionId, string input)
    {
        var roomId = await EnsureTerminalOwnerAsync(sessionId);
        if (string.IsNullOrEmpty(input) || input.Length > 4096 || !_terminalSessions.AllowCommand(Context.ConnectionId, roomId, sessionId))
            throw new HubException("Terminal input rate limit reached. Wait a moment and try again.");
        await _executionService.WriteTerminalInputAsync(sessionId, input, Context.ConnectionAborted);
    }

    public async Task<TerminalOutputResult> ReadTerminalOutput(string sessionId, int offset)
    {
        var roomId = await EnsureTerminalOwnerAsync(sessionId);
        if (!_terminalSessions.AllowPoll(Context.ConnectionId, roomId, sessionId))
            throw new HubException("Terminal output is being requested too quickly.");
        return await _executionService.ReadTerminalOutputAsync(sessionId, offset, Context.ConnectionAborted);
    }

    public async Task CloseTerminal(string sessionId)
    {
        var roomId = await EnsureTerminalOwnerAsync(sessionId);
        _terminalSessions.Remove(Context.ConnectionId, roomId, sessionId);
        await _executionService.CloseTerminalAsync(sessionId, Context.ConnectionAborted);
    }

    private async Task<string> EnsureTerminalOwnerAsync(string sessionId)
    {
        var roomId = await _store.GetConnectionRoomAsync(Context.ConnectionId);
        if (string.IsNullOrEmpty(roomId)) throw new HubException("Join a room before using a terminal.");
        await EnsureParticipantAsync(roomId);
        if (sessionId.Length != 32 || !sessionId.All(Uri.IsHexDigit) ||
            !_terminalSessions.Owns(Context.ConnectionId, roomId, sessionId))
            throw new HubException("Terminal session not found.");
        return roomId;
    }

    public async Task<ExecutionSubmissionResult> RunExecution(
        string language,
        string source,
        string requestId)
    {
        var roomId = await _store.GetConnectionRoomAsync(Context.ConnectionId);
        if (string.IsNullOrEmpty(roomId))
            throw new HubException("Join a room before running code.");
        await EnsureParticipantAsync(roomId);

        if (!Guid.TryParse(requestId, out var requestGuid))
            throw new HubException("Invalid execution request.");
        if (source is null || Encoding.UTF8.GetByteCount(source) > 64 * 1024)
            throw new HubException("Source must be 64 KB or less.");

        var executionLanguage = language?.Trim().ToLowerInvariant() switch
        {
            "javascript" => "JavaScript",
            "typescript" => "TypeScript",
            "python" => "Python",
            "csharp" or "c#" => "CSharp",
            "c" => "C",
            "cpp" or "c++" => "Cpp",
            "rust" => "Rust",
            "java" => "Java",
            _ => throw new HubException("This file type cannot be run in the terminal."),
        };
        var participant = await _store.GetParticipantAsync(roomId, Context.ConnectionId)
            ?? throw new HubException("Join a room before running code.");

        var submission = await _executionService.SubmitAsync(
            roomId,
            participant.UserId ?? participant.DisplayName,
            executionLanguage,
            source,
            requestGuid.ToString("N"),
            Context.ConnectionAborted);
        if (!_terminalSessions.TryAddExecution(Context.ConnectionId, roomId, submission.JobId))
            throw new HubException("Could not attach an interactive terminal to this run.");
        return submission;
    }

    public async Task WriteExecutionInput(string jobId, string input)
    {
        var roomId = await _store.GetConnectionRoomAsync(Context.ConnectionId);
        if (string.IsNullOrEmpty(roomId)) throw new HubException("Join a room before using the terminal.");
        await EnsureParticipantAsync(roomId);
        if (jobId.Length != 32 || !jobId.All(Uri.IsHexDigit) || !_terminalSessions.OwnsExecution(Context.ConnectionId, roomId, jobId))
            throw new HubException("Execution not found.");
        if (string.IsNullOrEmpty(input) || input.Length > 1024 || !_terminalSessions.AllowExecutionInput(Context.ConnectionId, roomId, jobId))
            throw new HubException("Terminal input rate limit reached. Wait a moment and try again.");
        await _executionService.WriteExecutionInputAsync(jobId, input, Context.ConnectionAborted);
    }

    public override async Task OnConnectedAsync()
    {
        if (!await _store.TryRegisterConnectionAsync(
                Context.ConnectionId,
                _instanceId,
                _roomLimits.MaxConnectionsPerInstance))
        {
            Context.Abort();
            return;
        }
        await base.OnConnectedAsync();
    }

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
                        await _store.RemoveParticipantAsync(previousRoomId, previousParticipant.ConnectionId, previousParticipant.InstanceId);
                    }
                }

                await _store.ClearUserRoomAsync(userId);
            }
            await _store.SetUserRoomAsync(userId, roomId);
        }

        var oldRoomId = await _store.GetConnectionRoomAsync(Context.ConnectionId);
        if (!string.IsNullOrEmpty(oldRoomId) && oldRoomId != roomId)
        {
            foreach (var sessionId in _terminalSessions.RemoveAll(Context.ConnectionId))
            {
                try { await _executionService.CloseTerminalAsync(sessionId, CancellationToken.None); }
                catch (HubException) { }
            }
            await Groups.RemoveFromGroupAsync(Context.ConnectionId, oldRoomId);
            await _store.RemoveParticipantAsync(oldRoomId, Context.ConnectionId, _instanceId);
            await Clients.OthersInGroup(oldRoomId).SendAsync("PeerLeft", Context.ConnectionId);
        }

        await _store.GetParticipantsAsync(roomId);
        var admission = await _store.TryAdmitParticipantAsync(
            roomId,
            new Participant(Context.ConnectionId, displayName, participantColor, userId, false, false, _instanceId),
            _instanceId,
            _roomLimits.MaxParticipantsPerRoom,
            _roomLimits.MaxActiveRooms,
            _roomLimits.MaxConnectionsPerInstance);
        if (admission != 1)
        {
            throw new HubException(admission switch
            {
                0 => $"This room is full. Rooms can have up to {_roomLimits.MaxParticipantsPerRoom} participants.",
                -2 => "Syncode is at its active room limit. Please try again later.",
                -3 => "Syncode is at its connection limit. Please try again later.",
                _ => "This room is no longer available.",
            });
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

        var roomParticipants = await _store.GetParticipantsAsync(roomId);
        await Clients.Caller.SendAsync("RoomParticipants", roomParticipants);
        await Clients.Caller.SendAsync("ChatHistory", await _store.GetChatMessagesAsync(roomId));

        var peer = roomParticipants.FirstOrDefault(p => p.ConnectionId != Context.ConnectionId);
        if (peer != null)
            foreach (var file in files)
                await Clients.Client(peer.ConnectionId).SendAsync("RequestFileSnapshot", file.Id, Context.ConnectionId);

        await Clients.OthersInGroup(roomId)
            .SendAsync("PeerJoined", Context.ConnectionId, displayName, participantColor, userId,
                roomParticipants.First(p => p.ConnectionId == Context.ConnectionId).IsAdmin, false);
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
        await EnsureCanEditAsync(roomId);
        if (!await _store.TryConsumeFileEntryCreateRateLimitAsync(
                roomId,
                Context.ConnectionId,
                Guid.NewGuid().ToString("N")))
        {
            throw new HubException("File creation rate limit reached. Please wait before creating more files or folders.");
        }

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

    public async Task ToggleParticipantEditLock(string roomId, string targetConnectionId)
    {
        await EnsureParticipantAsync(roomId);
        if (string.IsNullOrWhiteSpace(targetConnectionId) || targetConnectionId == Context.ConnectionId)
            throw new HubException("You cannot change your own edit access.");

        var result = await _store.ToggleParticipantLockedAsync(
            roomId, Context.ConnectionId, targetConnectionId);
        if (result.Status == 0) throw new HubException("That participant is no longer in the room.");
        if (result.Status == -1) throw new HubException("Admins cannot be locked.");
        if (result.Status == -2) throw new HubException("Only a room admin can change edit access.");
        await Clients.Group(roomId).SendAsync("ParticipantUpdated", result.Participant);
    }

    public async Task SetParticipantAdmin(string roomId, string targetConnectionId, bool isAdmin)
    {
        await EnsureParticipantAsync(roomId);
        if (string.IsNullOrWhiteSpace(targetConnectionId))
            throw new HubException("Select a participant in this room.");

        var result = await _store.SetParticipantAdminAsync(
            roomId, Context.ConnectionId, targetConnectionId, isAdmin);
        if (result.Status == -1)
            throw new HubException("Only a room admin can manage admin access.");
        if (result.Status == 0)
            throw new HubException("That participant is no longer in the room.");

        await Clients.Group(roomId).SendAsync("ParticipantUpdated", result.Participant);
    }

    private async Task EnsureFileParticipantAsync(string roomId, string fileId)
    {
        await EnsureCanEditAsync(roomId);
        if (!(await _store.GetEntriesAsync(roomId)).Any(entry => entry.Id == fileId && !entry.IsFolder))
            throw new HubException("File no longer exists.");
    }

    private async Task EnsureEntryParticipantAsync(string roomId, string entryId)
    {
        await EnsureCanEditAsync(roomId);
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

    public async Task UpdateParticipantColor(string roomId, string color)
    {
        await EnsureParticipantAsync(roomId);
        if (color is not { Length: 7 } ||
            !System.Text.RegularExpressions.Regex.IsMatch(color, "^#[0-9a-fA-F]{6}$"))
        {
            throw new HubException("Choose an avatar color.");
        }

        var participant = await _store.UpdateParticipantColorAsync(
            roomId,
            Context.ConnectionId,
            color);
        if (participant is null)
            throw new HubException("Join this room before changing your avatar color.");

        await Clients.Group(roomId).SendAsync("ParticipantUpdated", participant);
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

    private async Task EnsureCanEditAsync(string roomId)
    {
        await EnsureParticipantAsync(roomId);
        var participant = await _store.GetParticipantAsync(roomId, Context.ConnectionId);
        if (participant?.IsLocked == true)
            throw new HubException("The room admin has locked your editing access.");
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        foreach (var sessionId in _terminalSessions.RemoveAll(Context.ConnectionId))
        {
            try { await _executionService.CloseTerminalAsync(sessionId, CancellationToken.None); }
            catch (HubException) { }
        }
        _terminalSessions.RemoveExecutions(Context.ConnectionId);
        var roomId = await _store.GetConnectionRoomAsync(Context.ConnectionId);
        if (!string.IsNullOrEmpty(roomId))
        {
            var participant = await _store.GetParticipantAsync(roomId, Context.ConnectionId);
            await _store.RemoveParticipantAsync(roomId, Context.ConnectionId, _instanceId);
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

        await _store.UnregisterConnectionAsync(Context.ConnectionId, _instanceId);

        await base.OnDisconnectedAsync(exception);
    }
}
