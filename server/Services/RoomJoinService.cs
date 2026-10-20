using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Options;
using server.Models;

namespace server.Services;

public sealed class RoomJoinService(
    RedisFileStore files,
    RedisParticipantStore participants,
    RedisRoomMetadataStore rooms,
    RedisRoomChatStore chat,
    RedisProjectTreeStore projectTree,
    ProjectTreeStateService projectTreeState,
    IOptions<RoomCapacityOptions> roomLimits)
{
    public async Task<RoomJoinRequest> ValidateAsync(
        string roomId,
        string accessKey,
        string displayName,
        string color,
        string? avatarUrl,
        string? creatorToken)
    {
        if (!await rooms.ValidateRoomAccessAsync(roomId, accessKey))
            throw new HubException("Invalid or expired room invitation.");

        var normalizedName = string.IsNullOrWhiteSpace(displayName) ? "Anonymous" : displayName.Trim();
        if (normalizedName.Length > 32)
            throw new HubException("Display names must be 32 characters or fewer.");
        var participantColor = ParticipantColorRules.IsValid(color)
            ? color
            : "#38bdf8";
        var roomHasCreatorToken = await rooms.HasRoomCreatorTokenAsync(roomId);
        var isRoomCreator = !string.IsNullOrEmpty(creatorToken) &&
            await rooms.ValidateRoomCreatorTokenAsync(roomId, creatorToken);
        if (roomHasCreatorToken && !string.IsNullOrEmpty(creatorToken) && !isRoomCreator)
            throw new HubException("The room creator credential is invalid.");

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
        string instanceId)
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
                request.AvatarUrl),
            instanceId,
            roomLimits.Value.MaxParticipantsPerRoom,
            roomLimits.Value.MaxActiveRooms,
            roomLimits.Value.MaxConnectionsPerInstance,
            request.IsRoomCreator);
        if (admission != 1)
            throw new HubException(admission switch
            {
                0 => $"This room is full. Rooms can have up to {roomLimits.Value.MaxParticipantsPerRoom} participants.",
                -2 => "Syncode is at its active room limit. Please try again later.",
                -3 => "Syncode is at its connection limit. Please try again later.",
                _ => "This room is no longer available.",
            });

        await rooms.TouchRoomAsync(roomId);
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
                snapshot = await files.GetSnapshotAsync(roomId);
                if (!string.IsNullOrEmpty(snapshot))
                    await files.SaveFileSnapshotAsync(roomId, fileId, snapshot);
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
            roomParticipants.FirstOrDefault(participant => participant.ConnectionId != connectionId)?.ConnectionId);
    }

}
