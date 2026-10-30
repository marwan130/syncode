namespace server.Application.Rooms;

public interface IRoomParticipantCommands : IRoomParticipantReader
{
    Task<Participant?> UpdateParticipantColorAsync(string roomId, string connectionId, string color);
    Task<Participant?> UpdateParticipantAvatarAsync(string roomId, string connectionId, string? avatarUrl);
    Task<ParticipantActionResult> ToggleParticipantLockedAsync(string roomId, string actorId, string targetId);
    Task<ParticipantActionResult> SetParticipantAdminAsync(string roomId, string actorId, string targetId, bool isAdmin);
    Task<ParticipantActionResult> KickParticipantAsync(string roomId, string actorId, string targetId);
    /// <summary>Server-initiated admin promotion that bypasses the actor-must-be-admin check.</summary>
    Task<Participant?> PromoteToAdminAsync(string roomId, string connectionId);
}

public sealed record ParticipantActionResult(int Status, Participant? Participant);
