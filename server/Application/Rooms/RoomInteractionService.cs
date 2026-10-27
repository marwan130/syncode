namespace server.Application.Rooms;

public sealed class RoomInteractionService(
    IRoomParticipantCommands participants,
    IRoomActivityStore roomActivity,
    IRoomChatStore chat,
    IRoomRateLimiter rateLimits)
{
    public async Task<Participant> UpdateColorAsync(string roomId, string connectionId, string color)
    {
        if (!ParticipantColorRules.IsValid(color))
            throw new RoomOperationException("Choose an avatar color.");
        return await participants.UpdateParticipantColorAsync(roomId, connectionId, color)
            ?? throw new RoomOperationException("Join this room before changing your avatar color.");
    }

    public async Task<Participant> UpdateAvatarAsync(
        string roomId,
        string connectionId,
        string? avatarUrl)
    {
        var normalizedAvatarUrl = ParticipantAvatarRules.Normalize(avatarUrl);
        return await participants.UpdateParticipantAvatarAsync(roomId, connectionId, normalizedAvatarUrl)
            ?? throw new RoomOperationException("Join this room before updating your profile picture.");
    }

    public async Task<ChatMessage?> SendChatAsync(string roomId, string connectionId, string content)
    {
        var normalizedContent = content?.Trim();
        if (string.IsNullOrWhiteSpace(normalizedContent)) return null;
        if (normalizedContent.Length > 2000)
            throw new RoomOperationException("Chat messages must be 2000 characters or fewer.");

        var messageId = Guid.NewGuid().ToString("N");
        if (!await rateLimits.TryConsumeChatAsync(roomId, connectionId, messageId))
            throw new RoomOperationException("Chat rate limit reached. Please wait before sending more messages.");
        var participant = await participants.GetParticipantAsync(roomId, connectionId)
            ?? throw new RoomOperationException("Join this room before sending updates.");
        var message = new ChatMessage(
            messageId,
            participant.DisplayName,
            participant.Color,
            normalizedContent,
            DateTimeOffset.UtcNow);
        await chat.AppendMessageAsync(roomId, message);
        await roomActivity.TouchRoomAsync(roomId);
        return message;
    }

    public async Task<Participant> ToggleEditLockAsync(string roomId, string actorId, string targetId)
    {
        if (string.IsNullOrWhiteSpace(targetId) || targetId == actorId)
            throw new RoomOperationException("You cannot change your own edit access.");
        var result = await participants.ToggleParticipantLockedAsync(roomId, actorId, targetId);
        if (result.Status == 0) throw new RoomOperationException("That participant is no longer in the room.");
        if (result.Status == -1) throw new RoomOperationException("Admins cannot be locked.");
        if (result.Status == -2) throw new RoomOperationException("Only a room admin can change edit access.");
        return result.Participant!;
    }

    public async Task<Participant> SetAdminAsync(
        string roomId, string actorId, string targetId, bool isAdmin)
    {
        if (string.IsNullOrWhiteSpace(targetId))
            throw new RoomOperationException("Select a participant in this room.");
        var result = await participants.SetParticipantAdminAsync(roomId, actorId, targetId, isAdmin);
        if (result.Status == -1) throw new RoomOperationException("Only a room admin can manage admin access.");
        if (result.Status == 0 || result.Participant is null)
            throw new RoomOperationException("That participant is no longer in the room.");
        return result.Participant;
    }

    public async Task<Participant> KickAsync(string roomId, string actorId, string targetId)
    {
        if (string.IsNullOrWhiteSpace(targetId))
            throw new RoomOperationException("Select a participant in this room.");
        var result = await participants.KickParticipantAsync(roomId, actorId, targetId);
        if (result.Status == -1) throw new RoomOperationException("Only a room admin can remove participants.");
        if (result.Status == -2) throw new RoomOperationException("You cannot remove yourself from the room.");
        if (result.Status == 0 || result.Participant is null)
            throw new RoomOperationException("That participant is no longer in the room.");
        return result.Participant;
    }
}
