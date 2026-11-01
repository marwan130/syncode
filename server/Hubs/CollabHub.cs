using Microsoft.AspNetCore.SignalR;
using System.Text;
using server.Application.Execution;
using server.Application.Projects;
using server.Application.Rooms;
using server.Models;
using server.Services;
using Microsoft.Extensions.Options;
using System.Text.Json;

namespace server.Hubs;

public class CollabHub : Hub
{
    private static readonly object PendingJoinContextKey = new();
    private readonly RoomCapacityOptions _roomLimits;
    private readonly string _instanceId;
    private readonly RoomFileService _roomFiles;
    private readonly RoomAuthorizationService _authorization;
    private readonly ProjectImportCancellationRegistry _projectImportCancellations;
    private readonly IRoomRecoveryStore _roomRecovery;
    private readonly IRoomParticipantStore _participants;
    private readonly RoomJoinService _join;
    private readonly ProjectImportService _projectImport;
    private readonly GithubRepositoryAccessStore _githubRepositoryAccess;
    private readonly TerminalSessionService _terminal;
    private readonly LanguageServerSessionService _languageServers;
    private readonly RoomInteractionService _interactions;
    private readonly IRoomJoinApprovalStore _joinApprovals;
    public CollabHub(
        IRoomParticipantStore participants,
        RoomJoinService join,
        ProjectImportService projectImport,
        GithubRepositoryAccessStore githubRepositoryAccess,
        TerminalSessionService terminal,
        LanguageServerSessionService languageServers,
        RoomInteractionService interactions,
        IRoomJoinApprovalStore joinApprovals,
        IOptions<RoomCapacityOptions> roomLimits,
        ServerInstanceIdentity instanceIdentity,
        RoomFileService roomFiles,
        RoomAuthorizationService authorization,
        ProjectImportCancellationRegistry projectImportCancellations,
        IRoomRecoveryStore roomRecovery)
    {
        _roomLimits = roomLimits.Value;
        _instanceId = instanceIdentity.Id;
        _participants = participants;
        _join = join;
        _projectImport = projectImport;
        _githubRepositoryAccess = githubRepositoryAccess;
        _terminal = terminal;
        _languageServers = languageServers;
        _interactions = interactions;
        _joinApprovals = joinApprovals;
        _roomFiles = roomFiles;
        _authorization = authorization;
        _projectImportCancellations = projectImportCancellations;
        _roomRecovery = roomRecovery;
    }

    public Task<TerminalSessionStartResult> StartTerminal() =>
        _terminal.StartAsync(Context.ConnectionId, Context.ConnectionAborted);

    public Task WriteTerminalInput(string sessionId, string input) =>
        _terminal.WriteInputAsync(Context.ConnectionId, sessionId, input, Context.ConnectionAborted);

    public Task<TerminalOutputResult> ReadTerminalOutput(string sessionId, int offset) =>
        _terminal.ReadOutputAsync(Context.ConnectionId, sessionId, offset, Context.ConnectionAborted);

    public Task CloseTerminal(string sessionId) =>
        _terminal.CloseAsync(Context.ConnectionId, sessionId, Context.ConnectionAborted);

    public Task<LanguageServerStartResult> StartLanguageServer(string language) =>
        _languageServers.StartAsync(Context.ConnectionId, language, Context.ConnectionAborted);

    public Task RunTerminalFile(string sessionId, string language, string sourcePath) =>
        _terminal.RunFileAsync(Context.ConnectionId, sessionId, language, sourcePath, Context.ConnectionAborted);
    public override async Task OnConnectedAsync()
    {
        if (!await _participants.TryRegisterConnectionAsync(
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
        string? avatarUrl = null,
        string? requestId = null)
    {
        var recoveredRoom = await _join.TryRestoreExpiredRoomAsync(
            roomId,
            accessKey,
            creatorToken,
            requestId);
        var joinRequest = await _join.ValidateAsync(
            roomId,
            accessKey,
            displayName,
            color,
            avatarUrl,
            creatorToken);
        var admission = await ResolveJoinAdmissionAsync(roomId, joinRequest, requestId);
        if (admission.ApprovalResult is not null) return admission.ApprovalResult;
        var pendingJoin = admission.PendingJoin;
        var approvedMember = admission.ApprovedMember;

        var oldRoomId = await _participants.GetConnectionRoomAsync(Context.ConnectionId);
        if (!string.IsNullOrEmpty(oldRoomId) && oldRoomId != roomId)
        {
            var oldParticipant = await _participants.GetParticipantAsync(oldRoomId, Context.ConnectionId);
            await _terminal.CloseConnectionSessionsAsync(Context.ConnectionId);
            await _languageServers.CloseConnectionSessionsAsync(Context.ConnectionId);
            await Groups.RemoveFromGroupAsync(Context.ConnectionId, oldRoomId);
            await _participants.RemoveParticipantAsync(oldRoomId, Context.ConnectionId, _instanceId);
            if (!string.IsNullOrEmpty(oldParticipant?.JoinRequestId))
            {
                await _joinApprovals.SaveMemberAsync(
                    oldRoomId,
                    oldParticipant.JoinRequestId,
                    Context.ConnectionId,
                    oldParticipant.DisplayName,
                    oldParticipant.Color,
                    oldParticipant.AvatarUrl,
                    oldParticipant.IsAdmin,
                    oldParticipant.IsLocked);
            }
            await Clients.OthersInGroup(oldRoomId).SendAsync("PeerLeft", Context.ConnectionId);
            var remaining = await _participants.GetParticipantsAsync(oldRoomId);
            var promoted = await PromoteRandomParticipantIfNoAdminAsync(oldRoomId, remaining);
            if (promoted is not null)
            {
                remaining = await _participants.GetParticipantsAsync(oldRoomId);
                await Clients.Client(promoted.ConnectionId).SendAsync(
                    "RoomJoinRequestsChanged",
                    await _joinApprovals.GetRequestsAsync(oldRoomId));
            }
            if (remaining.Count > 0)
            {
                await Clients.Group(oldRoomId).SendAsync(
                    "RoomParticipants",
                    remaining.Select(RoomParticipantView.From));
            }
        }

        var joined = await _join.JoinAsync(
            joinRequest,
            Context.ConnectionId,
            _instanceId,
            pendingJoin?.RequestId,
            approvedMember is not null,
            approvedMember?.IsAdmin ?? false,
            approvedMember?.IsLocked ?? false,
            admission.HasReturningAdmin);
        if (pendingJoin is not null)
        {
            Context.Items.Remove(PendingJoinContextKey);
            await PublishJoinRequestsToAdminsAsync(roomId);
        }
        await Groups.AddToGroupAsync(Context.ConnectionId, roomId);
        await Clients.Caller.SendAsync("GithubRepositoryBaseline", joined.GithubRepository);
        await Clients.Caller.SendAsync("ProjectRootNameChanged", joined.ProjectRootName);
        await Clients.Caller.SendAsync("RoomFiles", joined.Files);
        if (!string.IsNullOrEmpty(joined.ProjectTreeSnapshot))
            await Clients.Caller.SendAsync("ProjectTreeSnapshot", joined.ProjectTreeSnapshot);
        await Clients.Caller.SendAsync("ProjectTreeHistory", joined.ProjectTreeHistoryItems);
        foreach (var snapshot in joined.FileSnapshots)
            await Clients.Caller.SendAsync("LoadFileSnapshot", snapshot.Key, snapshot.Value);
        await Clients.Caller.SendAsync(
            "RoomParticipants",
            joined.Participants.Select(RoomParticipantView.From));
        await Clients.Caller.SendAsync("ChatHistory", joined.ChatMessages);

        if (joined.PeerConnectionId is { } peerConnectionId)
            foreach (var fileId in joined.ProjectFileIds)
                await Clients.Client(peerConnectionId).SendAsync("RequestFileSnapshot", fileId, Context.ConnectionId);

        var localParticipant = joined.Participants.First(participant =>
            participant.ConnectionId == Context.ConnectionId);
        if (pendingJoin is not null)
        {
            await _joinApprovals.SaveMemberAsync(
                roomId,
                pendingJoin.RequestId,
                Context.ConnectionId,
                localParticipant.DisplayName,
                localParticipant.Color,
                localParticipant.AvatarUrl,
                localParticipant.IsAdmin,
                localParticipant.IsLocked);
            await _joinApprovals.RemoveRequestAsync(
                roomId,
                pendingJoin.RequestId,
                Context.ConnectionId);
        }
        await Clients.OthersInGroup(roomId)
            .SendAsync(
                "PeerJoined",
                Context.ConnectionId,
                joined.DisplayName,
                joined.Color,
                localParticipant.IsAdmin,
                false,
                localParticipant.AvatarUrl,
                RoomParticipantView.From(localParticipant).MemberId);
        await PublishJoinRequestsToAdminsAsync(roomId);
        return new RoomJoinResult("joined", recoveredRoom);
    }

    public sealed record RoomJoinResult(string Status, bool Recovered = false);
    private sealed record PendingJoinContext(string RoomId, string RequestId);
    private sealed record JoinAdmissionState(
        PendingJoinContext? PendingJoin,
        PendingRoomJoinRequest? ApprovedMember,
        bool HasReturningAdmin,
        RoomJoinResult? ApprovalResult);

    private async Task<JoinAdmissionState> ResolveJoinAdmissionAsync(
        string roomId,
        RoomJoinRequest joinRequest,
        string? requestId)
    {
        var hasAdmin = (await _participants.GetParticipantsAsync(roomId))
            .Any(participant => participant.IsAdmin);
        var roomHadAdmin = await _joinApprovals.HasHadAdminAsync(roomId);
        var hasReturningAdmin = await _joinApprovals.HasApprovedAdminAsync(roomId);
        var pendingJoin = Context.Items.TryGetValue(PendingJoinContextKey, out var pendingValue) &&
            pendingValue is PendingJoinContext existingRequest && existingRequest.RoomId == roomId
                ? existingRequest
                : null;
        if (pendingJoin is null && IsValidJoinRequestId(requestId))
            pendingJoin = new PendingJoinContext(roomId, requestId!);

        var approvedMember = pendingJoin is null
            ? null
            : await _joinApprovals.GetApprovedMemberAsync(
                roomId,
                pendingJoin.RequestId,
                Context.ConnectionId);
        var isApprovedRequest =
            (approvedMember is not null && !approvedMember.RequiresApproval) ||
            (pendingJoin is not null && await _joinApprovals.IsApprovedRequestAsync(
                roomId,
                pendingJoin.RequestId,
                Context.ConnectionId));
        var approvalResult = await GetJoinApprovalResultAsync(
            roomId,
            joinRequest,
            pendingJoin,
            requestId,
            await _participants.IsParticipantAsync(roomId, Context.ConnectionId),
            hasAdmin,
            roomHadAdmin,
            hasReturningAdmin,
            approvedMember?.RequiresApproval == true,
            isApprovedRequest);
        return new JoinAdmissionState(
            pendingJoin,
            approvedMember,
            hasReturningAdmin,
            approvalResult);
    }

    private static bool IsValidJoinRequestId(string? requestId) =>
        requestId is { Length: 32 } && requestId.All(Uri.IsHexDigit);

    private async Task<RoomJoinResult?> GetJoinApprovalResultAsync(
        string roomId,
        RoomJoinRequest joinRequest,
        PendingJoinContext? pendingJoin,
        string? requestId,
        bool alreadyJoined,
        bool hasAdmin,
        bool roomHadAdmin,
        bool hasReturningAdmin,
        bool requiresApproval,
        bool isApproved)
    {
        if (alreadyJoined || joinRequest.IsRoomCreator) return null;
        if (pendingJoin is not null && await _joinApprovals.IsRejectedAsync(roomId, pendingJoin.RequestId))
            return new RoomJoinResult("rejected");
        if (isApproved || (!requiresApproval && !hasAdmin && roomHadAdmin && !hasReturningAdmin)) return null;

        var stableRequestId = pendingJoin?.RequestId ??
            (IsValidJoinRequestId(requestId) ? requestId! : Guid.NewGuid().ToString("N"));
        var requestCreated = await _joinApprovals.UpsertRequestAsync(
            roomId,
            stableRequestId,
            Context.ConnectionId,
            joinRequest.DisplayName,
            joinRequest.Color,
            joinRequest.AvatarUrl,
            _roomLimits.MaxParticipantsPerRoom);
        if (!requestCreated)
            throw new RoomOperationException("This room has too many pending join requests. Try again later.");
        Context.Items[PendingJoinContextKey] = new PendingJoinContext(roomId, stableRequestId);
        await PublishJoinRequestsToAdminsAsync(roomId);
        return new RoomJoinResult("pending");
    }

    public async Task ApproveRoomJoinRequest(string roomId, string requestId)
    {
        await _authorization.EnsureAdminAsync(roomId, Context.ConnectionId);
        var request = await _joinApprovals.ApproveAsync(roomId, requestId)
            ?? throw new RoomOperationException("That join request is no longer available.");
        await Clients.Client(request.ConnectionId).SendAsync("RoomJoinApproved");
        await PublishJoinRequestsToAdminsAsync(roomId);
    }

    public async Task RejectRoomJoinRequest(string roomId, string requestId)
    {
        await _authorization.EnsureAdminAsync(roomId, Context.ConnectionId);
        var request = await _joinApprovals.RejectAsync(roomId, requestId)
            ?? throw new RoomOperationException("That join request is no longer available.");
        await Clients.Client(request.ConnectionId).SendAsync("RoomJoinRejected");
        await PublishJoinRequestsToAdminsAsync(roomId);
    }

    public async Task<IReadOnlyList<RoomJoinRequestView>> GetRoomJoinRequests(string roomId)
    {
        await _authorization.EnsureAdminAsync(roomId, Context.ConnectionId);
        return await _joinApprovals.GetRequestsAsync(roomId);
    }

    private async Task PublishJoinRequestsToAdminsAsync(string roomId)
    {
        var requests = await _joinApprovals.GetRequestsAsync(roomId);
        var admins = (await _participants.GetParticipantsAsync(roomId))
            .Where(participant => participant.IsAdmin);
        foreach (var admin in admins)
            await Clients.Client(admin.ConnectionId).SendAsync("RoomJoinRequestsChanged", requests);
    }

    public async Task SaveFileSnapshot(string roomId, string fileId, string snapshotJson)
    {
        await _roomFiles.SaveSnapshotAsync(roomId, fileId, snapshotJson, Context.ConnectionId);
    }

    public async Task SyncOfflineSnapshots(
        string roomId,
        IReadOnlyList<ProjectFileSnapshot>? snapshots)
    {
        if (snapshots is null)
            throw new RoomOperationException("The room workspace snapshot is invalid.");
        await _roomFiles.SaveOfflineSnapshotsAsync(roomId, Context.ConnectionId, snapshots);
        foreach (var snapshot in snapshots)
            await Clients.OthersInGroup(roomId).SendAsync(
                "LoadFileSnapshot",
                snapshot.FileId,
                snapshot.Snapshot);
    }

    public async Task<IReadOnlyList<ProjectTreeMutation>> ImportProject(
        string roomId,
        string importId,
        IReadOnlyList<ProjectImportFile>? files,
        GithubRepositoryBaseline? repositoryBaseline = null,
        string? projectRootName = null,
        bool replaceWorkspace = false)
    {
        using var cancellation = _projectImportCancellations.Begin(Context.ConnectionId, importId);
        await _authorization.EnsureCanEditAsync(roomId, Context.ConnectionId);
        var result = await _projectImport.ImportAsync(
            roomId,
            Context.ConnectionId,
            importId,
            files,
            repositoryBaseline,
            projectRootName,
            replaceWorkspace,
            completed => Clients.Client(Context.ConnectionId)
                .SendAsync("ProjectImportProgress", importId, completed),
            cancellationToken: cancellation.Token);
        foreach (var operation in result.ChangedOperations)
            await Clients.Group(roomId).SendAsync("ProjectTreeOperation", operation);
        foreach (var file in result.Files)
            await Clients.Group(roomId).SendAsync("LoadFileSnapshot", file.FileId, file.Snapshot);
        await Clients.Group(roomId).SendAsync("GithubRepositoryBaseline", repositoryBaseline);
        await Clients.Group(roomId).SendAsync("ProjectRootNameChanged", result.ProjectRootName);
        return result.Operations;
    }

    public async Task CancelProjectImport(string roomId, string importId)
    {
        await _authorization.EnsureCanEditAsync(roomId, Context.ConnectionId);
        _projectImportCancellations.Cancel(Context.ConnectionId, importId);
    }

    public async Task<IReadOnlyList<ProjectTreeMutation>> RestoreExpiredWorkspace(
        IReadOnlyList<ProjectImportFile>? files,
        string? projectRootName)
    {
        var roomId = await _participants.GetConnectionRoomAsync(Context.ConnectionId);
        var participant = string.IsNullOrEmpty(roomId)
            ? null
            : await _participants.GetParticipantAsync(roomId, Context.ConnectionId);
        var requestId = participant?.JoinRequestId;
        if (string.IsNullOrEmpty(roomId) || string.IsNullOrEmpty(requestId))
            throw new RoomOperationException("This room is no longer available for workspace recovery.");
        await _authorization.EnsureParticipantAsync(roomId, Context.ConnectionId);
        if (await _roomRecovery.GetWorkspaceRestoreStatusAsync(roomId, requestId) == "complete")
            return [];
        await _authorization.EnsureCanEditAsync(roomId, Context.ConnectionId);
        if (await _roomRecovery.GetWorkspaceRestoreStatusAsync(roomId, requestId) != "pending" ||
            !await _roomRecovery.TryBeginWorkspaceRestoreAsync(roomId, requestId))
            throw new RoomOperationException("This room is no longer available for workspace recovery.");

        try
        {
            if (files is null || files.Count == 0)
            {
                if (!string.IsNullOrWhiteSpace(projectRootName))
                    await _projectImport.SetRootNameAsync(roomId, projectRootName);
                await _roomRecovery.CompleteWorkspaceRestoreAsync(roomId, requestId);
                return [];
            }

            var result = await _projectImport.ImportAsync(
                roomId,
                Context.ConnectionId,
                Guid.NewGuid().ToString("N"),
                files,
                projectRootName: projectRootName,
                replaceWorkspace: true,
                allowRecoveryImport: true);
            foreach (var operation in result.ChangedOperations)
                await Clients.Group(roomId).SendAsync("ProjectTreeOperation", operation);
            foreach (var file in result.Files)
                await Clients.Group(roomId).SendAsync("LoadFileSnapshot", file.FileId, file.Snapshot);
            await Clients.Group(roomId).SendAsync("ProjectRootNameChanged", result.ProjectRootName);
            await _roomRecovery.CompleteWorkspaceRestoreAsync(roomId, requestId);
            return result.Operations;
        }
        catch
        {
            await _roomRecovery.CancelWorkspaceRestoreAsync(roomId, requestId);
            throw;
        }
    }

    public async Task<string> CreateGithubRepositoryAdminGrant(string roomId)
    {
        if (string.IsNullOrWhiteSpace(roomId) ||
            await _participants.GetConnectionRoomAsync(Context.ConnectionId) != roomId)
            throw new RoomOperationException("Join this room before importing a repository.");
        return await _githubRepositoryAccess.CreateAdminGrantAsync(roomId, Context.ConnectionId);
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
        var participant = await _interactions.ToggleEditLockAsync(roomId, Context.ConnectionId, targetConnectionId);
        if (!string.IsNullOrEmpty(participant.JoinRequestId))
            await _joinApprovals.UpdateMemberLockAsync(roomId, participant.JoinRequestId, participant.IsLocked);
        await Clients.Group(roomId).SendAsync("ParticipantUpdated", RoomParticipantView.From(participant));
    }
    public async Task SetParticipantAdmin(string roomId, string targetConnectionId, bool isAdmin)
    {
        await _authorization.EnsureParticipantAsync(roomId, Context.ConnectionId);
        var participant = await _interactions.SetAdminAsync(roomId, Context.ConnectionId, targetConnectionId, isAdmin);
        await Clients.Group(roomId).SendAsync("ParticipantUpdated", RoomParticipantView.From(participant));
        if (!isAdmin)
            await Clients.Client(targetConnectionId).SendAsync(
                "RoomJoinRequestsChanged",
                Array.Empty<RoomJoinRequestView>());
        await PublishJoinRequestsToAdminsAsync(roomId);
    }
    public async Task KickParticipant(string roomId, string targetConnectionId)
    {
        await _authorization.EnsureParticipantAsync(roomId, Context.ConnectionId);
        await _interactions.KickAsync(roomId, Context.ConnectionId, targetConnectionId);
        await Groups.RemoveFromGroupAsync(targetConnectionId, roomId);
        var participants = await _participants.GetParticipantsAsync(roomId);
        await Clients.Group(roomId).SendAsync(
            "RoomParticipants",
            participants.Select(RoomParticipantView.From));
        await Clients.Client(targetConnectionId).SendAsync("KickedFromRoom");
    }

    public async Task LeaveRoomByTicket(string roomId, string accessKey, string requestId)
    {
        if (await _participants.GetConnectionRoomAsync(Context.ConnectionId) == roomId)
            return;
        await _join.ValidateAsync(roomId, accessKey, "Anonymous", "#38bdf8", null, null);
        await _joinApprovals.RemoveMemberAsync(roomId, requestId);
    }

    public async Task CancelJoinRequest(string roomId, string? requestId = null)
    {
        var targetRequestId = (Context.Items.TryGetValue(PendingJoinContextKey, out var pendingValue) &&
            pendingValue is PendingJoinContext pending && pending.RoomId == roomId)
                ? pending.RequestId
                : (IsValidJoinRequestId(requestId) ? requestId : null);

        if (!string.IsNullOrEmpty(targetRequestId))
        {
            await _joinApprovals.RemoveRequestAsync(roomId, targetRequestId, Context.ConnectionId);
            Context.Items.Remove(PendingJoinContextKey);
            await PublishJoinRequestsToAdminsAsync(roomId);
        }
    }

    public async Task LeaveRoom(string roomId)
    {
        var isParticipant = await _participants.IsParticipantAsync(roomId, Context.ConnectionId);
        if (!isParticipant)
        {
            await CancelJoinRequest(roomId);
            return;
        }

        var participant = await _participants.GetParticipantAsync(roomId, Context.ConnectionId);
        if (participant is null) return;

        await _terminal.CloseConnectionSessionsAsync(Context.ConnectionId);
        await _languageServers.CloseConnectionSessionsAsync(Context.ConnectionId);
        // Preserve the member's admin status so they rejoin with the same role.
        if (!string.IsNullOrEmpty(participant.JoinRequestId))
            await _joinApprovals.SaveMemberAsync(
                roomId,
                participant.JoinRequestId,
                Context.ConnectionId,
                participant.DisplayName,
                participant.Color,
                participant.AvatarUrl,
                participant.IsAdmin,
                participant.IsLocked);
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, roomId);
        await _participants.RemoveParticipantAsync(roomId, Context.ConnectionId, _instanceId);
        await Clients.OthersInGroup(roomId).SendAsync("PeerLeft", Context.ConnectionId);
        var participants = await _participants.GetParticipantsAsync(roomId);
        var promoted = await PromoteRandomParticipantIfNoAdminAsync(roomId, participants);
        if (promoted is not null)
        {
            participants = await _participants.GetParticipantsAsync(roomId);
            await Clients.Client(promoted.ConnectionId).SendAsync(
                "RoomJoinRequestsChanged",
                await _joinApprovals.GetRequestsAsync(roomId));
        }
        await Clients.Group(roomId).SendAsync(
            "RoomParticipants",
            participants.Select(RoomParticipantView.From));
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
        var participant = await _interactions.UpdateColorAsync(roomId, Context.ConnectionId, color);
        await Clients.Group(roomId).SendAsync("ParticipantUpdated", RoomParticipantView.From(participant));
    }

    public async Task UpdateParticipantAvatar(string? avatarUrl)
    {
        var roomId = await _participants.GetConnectionRoomAsync(Context.ConnectionId);
        if (string.IsNullOrWhiteSpace(roomId))
            throw new HubException("Join a room before updating your profile picture.");
        await _authorization.EnsureParticipantAsync(roomId, Context.ConnectionId);
        var participant = await _interactions.UpdateAvatarAsync(
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
        var message = await _interactions.SendChatAsync(roomId, Context.ConnectionId, content);
        if (message is not null) await Clients.Group(roomId).SendAsync("ChatMessage", message);
    }
    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        await _terminal.CloseConnectionSessionsAsync(Context.ConnectionId);
        await _languageServers.CloseConnectionSessionsAsync(Context.ConnectionId);
        var roomId = await _participants.GetConnectionRoomAsync(Context.ConnectionId);
        if (!string.IsNullOrEmpty(roomId))
        {
            var participant = await _participants.GetParticipantAsync(roomId, Context.ConnectionId);
            await _participants.RemoveParticipantAsync(roomId, Context.ConnectionId, _instanceId);
            await Clients.OthersInGroup(roomId).SendAsync("PeerLeft", Context.ConnectionId);
            var remaining = await _participants.GetParticipantsAsync(roomId);
            var promoted = await PromoteRandomParticipantIfNoAdminAsync(roomId, remaining);
            if (promoted is not null)
            {
                remaining = await _participants.GetParticipantsAsync(roomId);
                await Clients.Client(promoted.ConnectionId).SendAsync(
                    "RoomJoinRequestsChanged",
                    await _joinApprovals.GetRequestsAsync(roomId));
            }
            if (remaining.Count > 0)
                await Clients.Group(roomId).SendAsync(
                    "RoomParticipants",
                    remaining.Select(RoomParticipantView.From));
        }

        await _participants.UnregisterConnectionAsync(Context.ConnectionId, _instanceId);

        if (Context.Items.TryGetValue(PendingJoinContextKey, out var pendingValue) &&
            pendingValue is PendingJoinContext pending)
        {
            await _joinApprovals.RemoveRequestAsync(pending.RoomId, pending.RequestId, Context.ConnectionId);
            Context.Items.Remove(PendingJoinContextKey);
            await PublishJoinRequestsToAdminsAsync(pending.RoomId);
        }

        await base.OnDisconnectedAsync(exception);
    }

    /// <summary>
    /// If there is no admin among <paramref name="participants"/>, picks one at random,
    /// promotes them to admin, and returns the updated participant. Returns null if an
    /// admin already exists or the room is empty.
    /// </summary>
    private async Task<Participant?> PromoteRandomParticipantIfNoAdminAsync(
        string roomId,
        IReadOnlyList<Participant> participants)
    {
        if (participants.Count == 0) return null;
        if (participants.Any(p => p.IsAdmin)) return null;
        var startIndex = Random.Shared.Next(participants.Count);
        for (var offset = 0; offset < participants.Count; offset++)
        {
            var candidate = participants[(startIndex + offset) % participants.Count];
            var promoted = await _participants.PromoteToAdminAsync(
                roomId,
                candidate.ConnectionId);
            if (promoted is not null) return promoted;
        }
        return null;
    }
}
