using Microsoft.AspNetCore.SignalR;
using System.Text;
using server.Models;
using server.Services;
using Microsoft.Extensions.Options;
using System.Text.Json;

namespace server.Hubs;

public class CollabHub : Hub
{
    private static readonly object PendingJoinContextKey = new();
    private readonly CollabHubServices _services;
    private readonly RoomCapacityOptions _roomLimits;
    private readonly string _instanceId;
    private readonly RoomFileService _roomFiles;
    private readonly RoomAuthorizationService _authorization;
    public CollabHub(
        CollabHubServices services,
        IOptions<RoomCapacityOptions> roomLimits,
        ServerInstanceIdentity instanceIdentity,
        RoomFileService roomFiles,
        RoomAuthorizationService authorization)
    {
        _roomLimits = roomLimits.Value;
        _instanceId = instanceIdentity.Id;
        _services = services;
        _roomFiles = roomFiles;
        _authorization = authorization;
    }

    private RedisParticipantStore Participants => _services.Participants;
    private ExecutionServiceClient ExecutionService => _services.Execution;
    private TerminalSessionRegistry TerminalSessions => _services.TerminalSessions;

    public Task<TerminalSessionStartResult> StartTerminal() =>
        _services.Terminal.StartAsync(Context.ConnectionId, Context.ConnectionAborted);

    public Task WriteTerminalInput(string sessionId, string input) =>
        _services.Terminal.WriteInputAsync(Context.ConnectionId, sessionId, input, Context.ConnectionAborted);

    public Task<TerminalOutputResult> ReadTerminalOutput(string sessionId, int offset) =>
        _services.Terminal.ReadOutputAsync(Context.ConnectionId, sessionId, offset, Context.ConnectionAborted);

    public Task CloseTerminal(string sessionId) =>
        _services.Terminal.CloseAsync(Context.ConnectionId, sessionId, Context.ConnectionAborted);

    public Task<ExecutionSubmissionResult> RunExecution(
        string language,
        string requestId,
        string sourcePath) =>
        _services.Terminal.RunAsync(
            Context.ConnectionId,
            new RunExecutionRequest(language, requestId, sourcePath),
            Context.ConnectionAborted);

    public Task WriteExecutionInput(string jobId, string input) =>
        _services.Terminal.WriteExecutionInputAsync(Context.ConnectionId, jobId, input, Context.ConnectionAborted);
    public override async Task OnConnectedAsync()
    {
        if (!await Participants.TryRegisterConnectionAsync(
                Context.ConnectionId,
                _instanceId,
                _roomLimits.MaxConnectionsPerInstance))
        {
            Context.Abort();
            return;
        }
        await base.OnConnectedAsync();
    }

    public async Task<RoomJoinResult> JoinRoom(
        string roomId,
        string accessKey,
        string displayName,
        string color,
        string? creatorToken = null,
        string? avatarUrl = null)
    {
        var joinRequest = await _services.Join.ValidateAsync(
            roomId,
            accessKey,
            displayName,
            color,
            avatarUrl,
            creatorToken);
        var hasAdmin = (await Participants.GetParticipantsAsync(roomId)).Any(participant => participant.IsAdmin);
        var roomHadAdmin = await _services.JoinApprovals.HasHadAdminAsync(roomId);
        var alreadyJoined = await Participants.IsParticipantAsync(roomId, Context.ConnectionId);
        var pendingJoin = Context.Items.TryGetValue(PendingJoinContextKey, out var pendingValue) &&
            pendingValue is PendingJoinContext existingRequest && existingRequest.RoomId == roomId
                ? existingRequest
                : null;
        var isApproved = pendingJoin is not null && await _services.JoinApprovals.IsApprovedAsync(
            roomId,
            pendingJoin.RequestId,
            Context.ConnectionId);
        if (!alreadyJoined && !joinRequest.IsRoomCreator && !isApproved && (hasAdmin || !roomHadAdmin))
        {
            var requestId = pendingJoin?.RequestId ?? Guid.NewGuid().ToString("N");
            var requestCreated = await _services.JoinApprovals.UpsertRequestAsync(
                roomId,
                requestId,
                Context.ConnectionId,
                joinRequest.DisplayName,
                joinRequest.Color,
                joinRequest.AvatarUrl,
                _roomLimits.MaxParticipantsPerRoom);
            if (!requestCreated)
                throw new HubOperationException("This room has too many pending join requests. Try again later.");
            Context.Items[PendingJoinContextKey] = new PendingJoinContext(roomId, requestId);
            await PublishJoinRequestsToAdminsAsync(roomId);
            return new RoomJoinResult("pending");
        }

        var oldRoomId = await Participants.GetConnectionRoomAsync(Context.ConnectionId);
        if (!string.IsNullOrEmpty(oldRoomId) && oldRoomId != roomId)
        {
            foreach (var sessionId in TerminalSessions.RemoveAll(Context.ConnectionId))
            {
                try { await ExecutionService.CloseTerminalAsync(sessionId, CancellationToken.None); }
                catch (HubException) { }
            }
            await Groups.RemoveFromGroupAsync(Context.ConnectionId, oldRoomId);
            await Participants.RemoveParticipantAsync(oldRoomId, Context.ConnectionId, _instanceId);
            await Clients.OthersInGroup(oldRoomId).SendAsync("PeerLeft", Context.ConnectionId);
        }

        var joined = await _services.Join.JoinAsync(joinRequest, Context.ConnectionId, _instanceId);
        if (pendingJoin is not null)
        {
            await _services.JoinApprovals.RemoveRequestAsync(
                roomId,
                pendingJoin.RequestId,
                Context.ConnectionId);
            Context.Items.Remove(PendingJoinContextKey);
            await PublishJoinRequestsToAdminsAsync(roomId);
        }
        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        await Clients.Caller.SendAsync("GithubRepositoryBaseline", joined.GithubRepository);
        await Clients.Caller.SendAsync("RoomFiles", joined.Files);
        if (!string.IsNullOrEmpty(joined.ProjectTreeSnapshot))
            await Clients.Caller.SendAsync("ProjectTreeSnapshot", joined.ProjectTreeSnapshot);
        await Clients.Caller.SendAsync("ProjectTreeHistory", joined.ProjectTreeHistoryItems);
        foreach (var snapshot in joined.FileSnapshots)
            await Clients.Caller.SendAsync("LoadFileSnapshot", snapshot.Key, snapshot.Value);
        await Clients.Caller.SendAsync("RoomParticipants", joined.Participants);
        await Clients.Caller.SendAsync("ChatHistory", joined.ChatMessages);

        if (joined.PeerConnectionId is { } peerConnectionId)
            foreach (var fileId in joined.ProjectFileIds)
                await Clients.Client(peerConnectionId).SendAsync("RequestFileSnapshot", fileId, Context.ConnectionId);

        var localParticipant = joined.Participants.First(participant =>
            participant.ConnectionId == Context.ConnectionId);
        await Clients.OthersInGroup(roomId)
            .SendAsync(
                "PeerJoined",
                Context.ConnectionId,
                joined.DisplayName,
                joined.Color,
                localParticipant.IsAdmin,
                false,
                localParticipant.AvatarUrl);
        if (localParticipant.IsAdmin)
            await Clients.Caller.SendAsync(
                "RoomJoinRequestsChanged",
                await _services.JoinApprovals.GetRequestsAsync(roomId));
        return new RoomJoinResult("joined");
    }

    public sealed record RoomJoinResult(string Status);
    private sealed record PendingJoinContext(string RoomId, string RequestId);

    public async Task ApproveRoomJoinRequest(string roomId, string requestId)
    {
        await _authorization.EnsureAdminAsync(roomId, Context.ConnectionId);
        var request = await _services.JoinApprovals.ApproveAsync(roomId, requestId)
            ?? throw new HubOperationException("That join request is no longer available.");
        await Clients.Client(request.ConnectionId).SendAsync("RoomJoinApproved");
        await PublishJoinRequestsToAdminsAsync(roomId);
    }

    public async Task RejectRoomJoinRequest(string roomId, string requestId)
    {
        await _authorization.EnsureAdminAsync(roomId, Context.ConnectionId);
        var request = await _services.JoinApprovals.RejectAsync(roomId, requestId)
            ?? throw new HubOperationException("That join request is no longer available.");
        await Clients.Client(request.ConnectionId).SendAsync("RoomJoinRejected");
        await PublishJoinRequestsToAdminsAsync(roomId);
    }

    private async Task PublishJoinRequestsToAdminsAsync(string roomId)
    {
        var requests = await _services.JoinApprovals.GetRequestsAsync(roomId);
        var admins = (await Participants.GetParticipantsAsync(roomId))
            .Where(participant => participant.IsAdmin);
        foreach (var admin in admins)
            await Clients.Client(admin.ConnectionId).SendAsync("RoomJoinRequestsChanged", requests);
    }

    public async Task SaveFileSnapshot(string roomId, string fileId, string snapshotJson)
    {
        await _roomFiles.SaveSnapshotAsync(roomId, fileId, snapshotJson, Context.ConnectionId);
    }

    public async Task<IReadOnlyList<ProjectTreeCreateOperation>> ImportProject(
        string roomId,
        string importId,
        IReadOnlyList<ProjectImportFile>? files,
        GithubRepositoryBaseline? repositoryBaseline = null)
    {
        await _authorization.EnsureCanEditAsync(roomId, Context.ConnectionId);
        var result = await _services.ProjectImport.ImportAsync(
            roomId, Context.ConnectionId, importId, files, repositoryBaseline);
        foreach (var operation in result.ChangedOperations)
            await Clients.Group(roomId).SendAsync("ProjectTreeOperation", operation);
        foreach (var file in result.Files)
            await Clients.Group(roomId).SendAsync("LoadFileSnapshot", file.FileId, file.Snapshot);
        await Clients.Group(roomId).SendAsync("GithubRepositoryBaseline", repositoryBaseline);
        return result.Operations;
    }

    public async Task<string> CreateGithubRepositoryAdminGrant(string roomId)
    {
        if (string.IsNullOrWhiteSpace(roomId) ||
            await Participants.GetConnectionRoomAsync(Context.ConnectionId) != roomId)
            throw new HubOperationException("Join this room before importing a repository.");
        return await _services.GithubRepositoryAccess.CreateAdminGrantAsync(roomId, Context.ConnectionId);
    }
    public async Task SendFileSnapshotToPeer(string roomId, string fileId, string targetConnectionId, string snapshotJson)
    {
        if (!await _roomFiles.SavePeerSnapshotAsync(
                roomId, fileId, targetConnectionId, snapshotJson, Context.ConnectionId)) return;
        await Clients.Client(targetConnectionId).SendAsync("LoadFileSnapshot", fileId, snapshotJson);
    }

    public async Task SendFileOp(string roomId, string fileId, CrdtOpDto op)
    {
        await _roomFiles.SendOperationAsync(roomId, fileId, Context.ConnectionId);
        await Clients.OthersInGroup(roomId).SendAsync("ReceiveFileOp", fileId, op);
    }

    public async Task ApplyProjectTreeOperation(string roomId, JsonElement operation)
    {
        if (await _roomFiles.ApplyTreeOperationAsync(roomId, operation, Context.ConnectionId))
            await Clients.OthersInGroup(roomId).SendAsync("ProjectTreeOperation", operation);
    }
    public async Task ToggleParticipantEditLock(string roomId, string targetConnectionId)
    {
        await _authorization.EnsureParticipantAsync(roomId, Context.ConnectionId);
        var participant = await _services.Interactions.ToggleEditLockAsync(roomId, Context.ConnectionId, targetConnectionId);
        await Clients.Group(roomId).SendAsync("ParticipantUpdated", participant);
    }
    public async Task SetParticipantAdmin(string roomId, string targetConnectionId, bool isAdmin)
    {
        await _authorization.EnsureParticipantAsync(roomId, Context.ConnectionId);
        var participant = await _services.Interactions.SetAdminAsync(roomId, Context.ConnectionId, targetConnectionId, isAdmin);
        await Clients.Group(roomId).SendAsync("ParticipantUpdated", participant);
        if (!isAdmin)
            await Clients.Client(targetConnectionId).SendAsync(
                "RoomJoinRequestsChanged",
                Array.Empty<RoomJoinRequestView>());
        await PublishJoinRequestsToAdminsAsync(roomId);
    }
    public async Task KickParticipant(string roomId, string targetConnectionId)
    {
        await _authorization.EnsureParticipantAsync(roomId, Context.ConnectionId);
        await _services.Interactions.KickAsync(roomId, Context.ConnectionId, targetConnectionId);
        await Groups.RemoveFromGroupAsync(targetConnectionId, roomId);
        var participants = await Participants.GetParticipantsAsync(roomId);
        await Clients.Group(roomId).SendAsync("RoomParticipants", participants);
        await Clients.Client(targetConnectionId).SendAsync("KickedFromRoom");
    }
    public async Task UpdateAwareness(string roomId, object awarenessState)
    {
        await _authorization.EnsureParticipantAsync(roomId, Context.ConnectionId);
        await Clients.OthersInGroup(roomId)
            .SendAsync("AwarenessUpdate", Context.ConnectionId, awarenessState);
    }

    public async Task UpdateParticipantColor(string roomId, string color)
    {
        await _authorization.EnsureParticipantAsync(roomId, Context.ConnectionId);
        var participant = await _services.Interactions.UpdateColorAsync(roomId, Context.ConnectionId, color);
        await Clients.Group(roomId).SendAsync("ParticipantUpdated", participant);
    }

    public async Task UpdateParticipantAvatar(string? avatarUrl)
    {
        var roomId = await Participants.GetConnectionRoomAsync(Context.ConnectionId);
        if (string.IsNullOrWhiteSpace(roomId))
            throw new HubException("Join a room before updating your profile picture.");
        await _authorization.EnsureParticipantAsync(roomId, Context.ConnectionId);
        var participant = await _services.Interactions.UpdateAvatarAsync(
            roomId,
            Context.ConnectionId,
            avatarUrl);
        await Clients.Group(roomId).SendAsync(
            "ParticipantAvatarUpdated",
            participant.ConnectionId,
            participant.AvatarUrl);
    }
    public async Task SendChatMessage(string roomId, string content)
    {
        await _authorization.EnsureParticipantAsync(roomId, Context.ConnectionId);
        var message = await _services.Interactions.SendChatAsync(roomId, Context.ConnectionId, content);
        if (message is not null) await Clients.Group(roomId).SendAsync("ChatMessage", message);
    }
    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        if (Context.Items.TryGetValue(PendingJoinContextKey, out var pendingValue) &&
            pendingValue is PendingJoinContext pendingJoin)
        {
            await _services.JoinApprovals.RemoveRequestAsync(
                pendingJoin.RoomId,
                pendingJoin.RequestId,
                Context.ConnectionId);
            await PublishJoinRequestsToAdminsAsync(pendingJoin.RoomId);
        }

        foreach (var sessionId in TerminalSessions.RemoveAll(Context.ConnectionId))
        {
            try { await ExecutionService.CloseTerminalAsync(sessionId, CancellationToken.None); }
            catch (HubException) { }
        }
        TerminalSessions.RemoveExecutions(Context.ConnectionId);
        var roomId = await Participants.GetConnectionRoomAsync(Context.ConnectionId);
        if (!string.IsNullOrEmpty(roomId))
        {
            await Participants.RemoveParticipantAsync(roomId, Context.ConnectionId, _instanceId);
            await Clients.OthersInGroup(roomId).SendAsync("PeerLeft", Context.ConnectionId);

        }

        await Participants.UnregisterConnectionAsync(Context.ConnectionId, _instanceId);

        await base.OnDisconnectedAsync(exception);
    }
}
