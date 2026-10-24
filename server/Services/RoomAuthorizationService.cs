namespace server.Services;

public sealed class RoomAuthorizationService(
    RedisParticipantStore participants,
    ProjectTreeStateService projectTreeState)
{
    public async Task EnsureParticipantAsync(string roomId, string connectionId)
    {
        if (string.IsNullOrWhiteSpace(roomId) ||
            await participants.GetConnectionRoomAsync(connectionId) != roomId ||
            !await participants.IsParticipantAsync(roomId, connectionId))
            throw new HubOperationException("Join this room before sending updates.");
    }

    public async Task EnsureCanEditAsync(string roomId, string connectionId)
    {
        await EnsureParticipantAsync(roomId, connectionId);
        var participant = await participants.GetParticipantAsync(roomId, connectionId);
        if (participant?.IsLocked == true)
            throw new HubOperationException("The room admin has locked your editing access.");
    }

    public async Task EnsureAdminAsync(string roomId, string connectionId)
    {
        await EnsureParticipantAsync(roomId, connectionId);
        if (await participants.GetParticipantAsync(roomId, connectionId) is not { IsAdmin: true })
            throw new HubOperationException("Only a room admin can manage join requests.");
    }

    public async Task EnsureFileParticipantAsync(string roomId, string fileId, string connectionId)
    {
        await EnsureCanEditAsync(roomId, connectionId);
        if (!await projectTreeState.IsFileAsync(roomId, fileId))
            throw new HubOperationException("File no longer exists.");
    }
}
