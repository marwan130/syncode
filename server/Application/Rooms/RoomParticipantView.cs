using System.Security.Cryptography;
using System.Text;

namespace server.Application.Rooms;

public sealed record RoomParticipantView(
    string ConnectionId,
    string DisplayName,
    string Color,
    string UserId,
    bool IsAdmin,
    bool IsLocked,
    string? AvatarUrl,
    string? MemberId)
{
    public static RoomParticipantView From(Participant participant) => new(
        participant.ConnectionId,
        participant.DisplayName,
        participant.Color,
        participant.UserId,
        participant.IsAdmin,
        participant.IsLocked,
        participant.AvatarUrl,
        string.IsNullOrEmpty(participant.JoinRequestId)
            ? null
            : Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(participant.JoinRequestId))));
}
