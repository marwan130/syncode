using server.Application.Projects;

namespace server.Application.Rooms;

public sealed class RoomJoinService(
    IProjectSnapshotReader files,
    IProjectSnapshotWriter fileSnapshotWriter,
    IRoomParticipantAdmissionStore participants,
    IRoomInvitationStore invitations,
    IRoomActivityStore roomActivity,
    IRoomChatHistoryReader chat,
    IProjectTreeOperationStore projectTree,
    IProjectTreeStateReader projectTreeState,
    IProjectImportBaselineStore githubRepository,
    IProjectRootNameStore projectRootNames,
    IRoomRecoveryStore recovery,
    RoomCapacityLimits roomLimits)
{
    public Task<bool> TryRestoreExpiredRoomAsync(
        string roomId,
        string accessKey,
        string? creatorToken,
        string? requestId) =>
        recovery.TryRestoreExpiredRoomAsync(roomId, accessKey, creatorToken, requestId);

    public async Task<RoomJoinRequest> ValidateAsync(
        string roomId,
        string accessKey,
        string displayName,
        string color,
        string? avatarUrl,
        string? creatorToken)
    {
        if (!await invitations.ValidateRoomAccessAsync(roomId, accessKey))
            throw new RoomOperationException("Invalid or expired room invitation.");

        var normalizedName = string.IsNullOrWhiteSpace(displayName) ? "Anonymous" : displayName.Trim();
        if (normalizedName.Length > 32)
            throw new RoomOperationException("Display names must be 32 characters or fewer.");
        var participantColor = ParticipantColorRules.IsValid(color)
            ? color
            : "#38bdf8";
        var roomHasCreatorToken = await invitations.HasRoomCreatorTokenAsync(roomId);
        var isRoomCreator = !string.IsNullOrEmpty(creatorToken) &&
            await invitations.ValidateRoomCreatorTokenAsync(roomId, creatorToken);
        if (roomHasCreatorToken && !string.IsNullOrEmpty(creatorToken) && !isRoomCreator)
            throw new RoomOperationException("The room creator credential is invalid.");

        return new RoomJoinRequest(
            roomId,
            normalizedName,
            participantColor,
            isRoomCreator,
            ParticipantAvatarRules.Normalize(avatarUrl));
    }

    public async Task<RoomJoinState> JoinAsync(
        RoomJoinRequest request,
        string connectionId,
        string instanceId,
        string? joinRequestId = null,
        bool isReturningMember = false,
        bool returningMemberIsAdmin = false,
        bool returningMemberIsLocked = false,
        bool hasReturningAdmin = false)
    {
        var roomId = request.RoomId;

        await participants.GetParticipantsAsync(roomId);
        var admission = await participants.TryAdmitParticipantAsync(
            roomId,
            new Participant(
                connectionId,
                request.DisplayName,
                request.Color,
                string.Empty,
                false,
                false,
                instanceId,
                request.AvatarUrl,
                joinRequestId ?? string.Empty),
            instanceId,
            roomLimits.MaxParticipantsPerRoom,
            roomLimits.MaxActiveRooms,
            roomLimits.MaxConnectionsPerInstance,
            request.IsRoomCreator,
            isReturningMember,
            returningMemberIsAdmin,
            returningMemberIsLocked,
            hasReturningAdmin);
        if (admission != 1)
            throw new RoomOperationException(admission switch
            {
                0 => $"This room is full. Rooms can have up to {roomLimits.MaxParticipantsPerRoom} participants.",
                -2 => "Syncode is at its active room limit. Please try again later.",
                -3 => "Syncode is at its connection limit. Please try again later.",
                _ => "This room is no longer available.",
            });

        await roomActivity.TouchRoomAsync(roomId);
        var entries = await projectTreeState.GetEntriesAsync(roomId);
        var roomFiles = entries.Values.ToArray();
        var treeSnapshot = await projectTree.GetProjectTreeSnapshotAsync(roomId);
        var treeHistory = await projectTree.GetProjectTreeOperationsAsync(roomId);
        var fileIds = entries.Values
            .Where(entry => !entry.IsFolder)
            .Select(entry => entry.Id)
            .ToArray();
        var fileSnapshots = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var fileId in fileIds)
        {
            var snapshot = await files.GetFileSnapshotAsync(roomId, fileId);
            if (string.IsNullOrEmpty(snapshot) && fileId == "main.cpp")
            {
                snapshot = await files.GetLegacyRoomSnapshotAsync(roomId);
                if (!string.IsNullOrEmpty(snapshot))
                    await fileSnapshotWriter.SaveFileSnapshotAsync(roomId, fileId, snapshot);
            }
            if (!string.IsNullOrEmpty(snapshot)) fileSnapshots[fileId] = snapshot;
        }

        var roomParticipants = await participants.GetParticipantsAsync(roomId);
        return new RoomJoinState(
            request.DisplayName,
            request.Color,
            roomFiles,
            treeSnapshot,
            treeHistory,
            fileIds,
            fileSnapshots,
            roomParticipants,
            await chat.GetMessagesAsync(roomId),
            roomParticipants.FirstOrDefault(participant => participant.ConnectionId != connectionId)?.ConnectionId,
            await githubRepository.GetAsync(roomId),
            await projectRootNames.GetProjectRootNameAsync(roomId));
    }
}
