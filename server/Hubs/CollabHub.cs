using Microsoft.AspNetCore.SignalR;
using System.Text;
using server.Models;
using server.Services;
using Microsoft.Extensions.Options;
using System.Text.Json;

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
        string requestId,
        string sourcePath,
        IReadOnlyList<ExecutionProjectFile>? projectFiles = null)
    {
        var roomId = await _store.GetConnectionRoomAsync(Context.ConnectionId);
        if (string.IsNullOrEmpty(roomId))
            throw new HubException("Join a room before running code.");
        await EnsureParticipantAsync(roomId);

        if (!Guid.TryParse(requestId, out var requestGuid))
            throw new HubException("Invalid execution request.");
        if (source is null || Encoding.UTF8.GetByteCount(source) > 64 * 1024)
            throw new HubException("Source must be 64 KB or less.");
        if (projectFiles is null || projectFiles.Count is < 1 or > 500 ||
            string.IsNullOrWhiteSpace(sourcePath) || !IsSafeProjectPath(sourcePath))
            throw new HubException("Invalid project files for execution.");
        if (!projectFiles.Any(file => file is not null && file.Path == sourcePath))
            throw new HubException("The active file is missing from the project run.");
        long projectBytes = 0;
        var projectPaths = new HashSet<string>(StringComparer.Ordinal);
        foreach (var file in projectFiles)
        {
            if (file is null || !IsSafeProjectPath(file.Path) || file.Content is null || !projectPaths.Add(file.Path))
                throw new HubException("Invalid project files for execution.");
            projectBytes += Encoding.UTF8.GetByteCount(file.Content);
        }
        var activeProjectFile = projectFiles.First(file => file.Path == sourcePath);
        if (projectBytes - Encoding.UTF8.GetByteCount(activeProjectFile.Content) + Encoding.UTF8.GetByteCount(source) > 64 * 1024)
            throw new HubException("Project files must total 64 KB or less to run.");

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
            sourcePath,
            projectFiles,
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
        var projectTreeSnapshot = await _store.GetProjectTreeSnapshotAsync(roomId);
        if (!string.IsNullOrEmpty(projectTreeSnapshot))
            await Clients.Caller.SendAsync("ProjectTreeSnapshot", projectTreeSnapshot);
        await Clients.Caller.SendAsync("ProjectTreeHistory", await _store.GetProjectTreeOperationsAsync(roomId));
        var fileIds = await _store.GetProjectFileIdsAsync(roomId);
        foreach (var fileId in fileIds)
        {
            var fileSnapshot = await _store.GetFileSnapshotAsync(roomId, fileId);
            if (string.IsNullOrEmpty(fileSnapshot) && fileId == "main.cpp")
            {
                fileSnapshot = await _store.GetSnapshotAsync(roomId);
                if (!string.IsNullOrEmpty(fileSnapshot))
                    await _store.SaveFileSnapshotAsync(roomId, fileId, fileSnapshot);
            }
            if (!string.IsNullOrEmpty(fileSnapshot))
                await Clients.Caller.SendAsync("LoadFileSnapshot", fileId, fileSnapshot);
        }

        var roomParticipants = await _store.GetParticipantsAsync(roomId);
        await Clients.Caller.SendAsync("RoomParticipants", roomParticipants);
        await Clients.Caller.SendAsync("ChatHistory", await _store.GetChatMessagesAsync(roomId));

        var peer = roomParticipants.FirstOrDefault(p => p.ConnectionId != Context.ConnectionId);
        if (peer != null)
            foreach (var fileId in fileIds)
                await Clients.Client(peer.ConnectionId).SendAsync("RequestFileSnapshot", fileId, Context.ConnectionId);

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

    public async Task ApplyProjectTreeOperation(string roomId, JsonElement operation)
    {
        await EnsureCanEditAsync(roomId);
        var operationJson = JsonSerializer.Serialize(operation);
        if (operationJson.Length > 16 * 1024)
            throw new HubException("Project tree update is too large.");

        if (operation.ValueKind != JsonValueKind.Object ||
            !operation.TryGetProperty("type", out var typeValue) || typeValue.ValueKind != JsonValueKind.String ||
            !operation.TryGetProperty("opId", out var idValue) || idValue.ValueKind != JsonValueKind.Object ||
            !idValue.TryGetProperty("siteId", out var siteValue) || siteValue.ValueKind != JsonValueKind.String ||
            !idValue.TryGetProperty("counter", out var counterValue) || !counterValue.TryGetInt64(out var counter))
            throw new HubException("Invalid project tree update.");

        var type = typeValue.GetString();
        var siteId = siteValue.GetString();
        if (string.IsNullOrWhiteSpace(siteId) || siteId.Length > 128 || siteId == "syncode-seed" ||
            counter < 1 || counter > 9_007_199_254_740_991L)
            throw new HubException("Invalid project tree update ID.");
        var operationId = $"{siteId}:{counter}";
        using var currentOperationDocument = JsonDocument.Parse(operationJson);
        var currentOperationValue = GetProjectTreeOperationValue(currentOperationDocument.RootElement)
            ?? throw new HubException("Invalid project tree update.");
        var previousOperationJson = await _store.GetProjectTreeOperationAsync(roomId, operationId);
        if (previousOperationJson is not null)
        {
            using var previousOperation = JsonDocument.Parse(previousOperationJson);
            if (GetProjectTreeOperationValue(previousOperation.RootElement) != currentOperationValue)
                throw new HubException("Conflicting project tree operation ID.");
            return;
        }

        if (type == "create")
        {
            if (!operation.TryGetProperty("entry", out var entryValue))
                throw new HubException("Invalid project tree entry.");
            var entry = JsonSerializer.Deserialize<RedisRoomStore.RoomEntry>(entryValue.GetRawText(),
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            if (entry is null || !IsSafeProjectIdentifier(entry.Id) || entry.ParentId is { } parentId && !IsSafeProjectIdentifier(parentId))
                throw new HubException("Invalid project tree entry.");
            if (ValidateFileName(entry.Name) != entry.Name)
                throw new HubException("Project entry names must be normalized.");
            var currentEntryIds = await GetKnownEntryIdsAsync(roomId);
            if (currentEntryIds.Contains(entry.Id))
                throw new HubException("That project entry already exists.");
            if (currentEntryIds.Count >= 500)
                throw new HubException("A room can contain up to 500 files and folders.");
            if (entry.ParentId is not null && !await IsKnownFolderAsync(roomId, entry.ParentId))
                throw new HubException("Parent folder no longer exists.");
        }
        else if (type == "rename")
        {
            if (!operation.TryGetProperty("entryId", out var entryIdValue) || entryIdValue.ValueKind != JsonValueKind.String ||
                !IsSafeProjectIdentifier(entryIdValue.GetString()!) ||
                !operation.TryGetProperty("name", out var nameValue) || nameValue.ValueKind != JsonValueKind.String)
                throw new HubException("Invalid project tree entry name.");
            if (ValidateFileName(nameValue.GetString()!) != nameValue.GetString())
                throw new HubException("Project entry names must be normalized.");
            if (!await IsKnownEntryAsync(roomId, entryIdValue.GetString()!))
                throw new HubException("File or folder no longer exists.");
        }
        else if (type == "move")
        {
            if (!operation.TryGetProperty("entryId", out var entryIdValue) || entryIdValue.ValueKind != JsonValueKind.String ||
                !IsSafeProjectIdentifier(entryIdValue.GetString()!) ||
                !operation.TryGetProperty("parentId", out var parentValue) ||
                (parentValue.ValueKind != JsonValueKind.Null &&
                 (parentValue.ValueKind != JsonValueKind.String || !IsSafeProjectIdentifier(parentValue.GetString()!))))
                throw new HubException("Invalid project tree parent.");
            if (parentValue.ValueKind == JsonValueKind.String && !await IsKnownFolderAsync(roomId, parentValue.GetString()!))
                throw new HubException("Parent folder no longer exists.");
            if (!await IsKnownEntryAsync(roomId, entryIdValue.GetString()!))
                throw new HubException("File or folder no longer exists.");
            if (parentValue.ValueKind == JsonValueKind.String &&
                await WouldCreateParentCycleAsync(roomId, entryIdValue.GetString()!, parentValue.GetString()!))
                throw new HubException("That move would create a folder cycle.");
        }
        else if (type == "delete")
        {
            if (!operation.TryGetProperty("entryId", out var entryIdValue) || entryIdValue.ValueKind != JsonValueKind.String ||
                !IsSafeProjectIdentifier(entryIdValue.GetString()!))
                throw new HubException("Invalid project tree entry.");
            if (!await IsKnownEntryAsync(roomId, entryIdValue.GetString()!))
                throw new HubException("File or folder no longer exists.");
        }
        else
        {
            throw new HubException("Unsupported project tree update.");
        }

        if (!await _store.TryConsumeFileEntryCreateRateLimitAsync(
                roomId, Context.ConnectionId, Guid.NewGuid().ToString("N")))
            throw new HubException("File update rate limit reached. Please wait before trying again.");

        var result = await _store.AppendProjectTreeOperationAsync(roomId, operationId, operationJson, siteId, counter);
        if (result == -1) throw new HubException("Conflicting project tree update ID.");
        if (result == -3) throw new HubException("That project entry already exists.");
        if (result == -2) throw new HubException("Invalid project tree update.");
        if (result == -5) throw new HubException("A room can contain up to 500 files and folders.");
        await _store.TouchRoomAsync(roomId);
        if (result == 1)
            await Clients.OthersInGroup(roomId).SendAsync("ProjectTreeOperation", operation);
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
        if (!(await _store.GetProjectFileIdsAsync(roomId)).Contains(fileId, StringComparer.Ordinal))
            throw new HubException("File no longer exists.");
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

    private static bool IsSafeProjectPath(string path)
    {
        if (string.IsNullOrWhiteSpace(path) || path.Length > 512 || path.StartsWith('/') ||
            path.Contains('\\') || path.Any(char.IsControl)) return false;
        return path.Split('/').All(segment => segment.Length > 0 && segment is not "." and not ".." &&
            segment.IndexOfAny([ ':', '*', '?', '"', '<', '>', '|' ]) < 0);
    }

    private static bool IsSafeProjectIdentifier(string value) =>
        value.Length is > 0 and <= 128 && value is not "." and not ".." &&
        value.All(character =>
            char.IsAsciiLetterOrDigit(character) || character is '-' or '_' or '.');

    private async Task<bool> IsKnownEntryAsync(string roomId, string entryId)
    {
        return (await GetKnownEntryIdsAsync(roomId)).Contains(entryId);
    }

    private async Task<HashSet<string>> GetKnownEntryIdsAsync(string roomId)
    {
        return (await GetKnownProjectEntriesAsync(roomId)).Keys.ToHashSet(StringComparer.Ordinal);
    }

    private async Task<Dictionary<string, RedisRoomStore.RoomEntry>> GetKnownProjectEntriesAsync(string roomId)
    {
        var entries = (await _store.GetEntriesAsync(roomId))
            .ToDictionary(entry => entry.Id, StringComparer.Ordinal);
        var deletedIds = new HashSet<string>(StringComparer.Ordinal);
        var snapshot = await _store.GetProjectTreeSnapshotAsync(roomId);
        if (!string.IsNullOrEmpty(snapshot))
        {
            using var document = JsonDocument.Parse(snapshot);
            if (document.RootElement.TryGetProperty("operations", out var operations) && operations.ValueKind == JsonValueKind.Array)
                foreach (var operation in operations.EnumerateArray())
                    ApplyProjectTreeOperation(operation, entries, deletedIds);
        }
        else
        {
            foreach (var operationJson in await _store.GetProjectTreeOperationsAsync(roomId))
            {
                using var document = JsonDocument.Parse(operationJson);
                ApplyProjectTreeOperation(document.RootElement, entries, deletedIds);
            }
        }
        foreach (var id in deletedIds) entries.Remove(id);

        foreach (var entry in entries.Values.ToArray())
        {
            var visited = new HashSet<string>(StringComparer.Ordinal) { entry.Id };
            var parentId = entry.ParentId;
            while (parentId is not null)
            {
                if (deletedIds.Contains(parentId))
                {
                    entries.Remove(entry.Id);
                    break;
                }
                if (!visited.Add(parentId) || !entries.TryGetValue(parentId, out var parent)) break;
                parentId = parent.ParentId;
            }
        }

        return entries;
    }

    private static void ApplyProjectTreeOperation(
        JsonElement operation,
        Dictionary<string, RedisRoomStore.RoomEntry> entries,
        HashSet<string> deletedIds)
    {
        if (!operation.TryGetProperty("type", out var typeValue) || typeValue.ValueKind != JsonValueKind.String) return;
        var type = typeValue.GetString();
        if (type == "create" && operation.TryGetProperty("entry", out var entry) && entry.ValueKind == JsonValueKind.Object)
        {
            var created = JsonSerializer.Deserialize<RedisRoomStore.RoomEntry>(entry.GetRawText(),
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            if (created is not null) entries[created.Id] = created;
        }
        else if (type == "rename" && operation.TryGetProperty("entryId", out var renameId) && renameId.ValueKind == JsonValueKind.String &&
            operation.TryGetProperty("name", out var name) && name.ValueKind == JsonValueKind.String &&
            entries.TryGetValue(renameId.GetString()!, out var renamed))
            entries[renamed.Id] = renamed with { Name = name.GetString()! };
        else if (type == "move" && operation.TryGetProperty("entryId", out var moveId) && moveId.ValueKind == JsonValueKind.String &&
            operation.TryGetProperty("parentId", out var parent) && (parent.ValueKind is JsonValueKind.Null or JsonValueKind.String) &&
            entries.TryGetValue(moveId.GetString()!, out var moved))
            entries[moved.Id] = moved with { ParentId = parent.ValueKind == JsonValueKind.Null ? null : parent.GetString() };
        else if (type == "delete" && operation.TryGetProperty("entryId", out var deleted) && deleted.ValueKind == JsonValueKind.String)
            deletedIds.Add(deleted.GetString()!);
    }

    private async Task<bool> IsKnownFolderAsync(string roomId, string folderId)
    {
        return (await GetKnownProjectEntriesAsync(roomId))
            .TryGetValue(folderId, out var entry) && entry.IsFolder;
    }

    private async Task<bool> WouldCreateParentCycleAsync(string roomId, string entryId, string parentId)
    {
        var parents = (await GetKnownProjectEntriesAsync(roomId))
            .Values
            .ToDictionary(entry => entry.Id, entry => entry.ParentId, StringComparer.Ordinal);

        var visited = new HashSet<string>(StringComparer.Ordinal);
        string? current = parentId;
        while (current is not null)
        {
            if (current == entryId || !visited.Add(current)) return true;
            current = parents.GetValueOrDefault(current);
        }
        return false;
    }

    private static string? GetProjectTreeOperationValue(JsonElement operation)
    {
        if (!operation.TryGetProperty("type", out var typeValue) || typeValue.ValueKind != JsonValueKind.String)
            return null;
        var type = typeValue.GetString();
        if (type == "create" && operation.TryGetProperty("entry", out var entry) && entry.ValueKind == JsonValueKind.Object &&
            entry.TryGetProperty("id", out var id) && id.ValueKind == JsonValueKind.String &&
            entry.TryGetProperty("name", out var name) && name.ValueKind == JsonValueKind.String &&
            entry.TryGetProperty("parentId", out var parent) &&
            entry.TryGetProperty("isFolder", out var folder) && (folder.ValueKind is JsonValueKind.True or JsonValueKind.False))
            return JsonSerializer.Serialize(new object?[] { type, id.GetString(), name.GetString(), parent.ValueKind == JsonValueKind.Null ? null : parent.GetString(), folder.GetBoolean() });
        if (type is "rename" or "move" or "delete" && operation.TryGetProperty("entryId", out var entryId) && entryId.ValueKind == JsonValueKind.String)
        {
            if (type == "rename" && operation.TryGetProperty("name", out var rename) && rename.ValueKind == JsonValueKind.String)
                return JsonSerializer.Serialize(new object?[] { type, entryId.GetString(), rename.GetString() });
            if (type == "move" && operation.TryGetProperty("parentId", out var moveParent))
                return JsonSerializer.Serialize(new object?[] { type, entryId.GetString(), moveParent.ValueKind == JsonValueKind.Null ? null : moveParent.GetString() });
            if (type == "delete") return JsonSerializer.Serialize(new object?[] { type, entryId.GetString() });
        }
        return null;
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
