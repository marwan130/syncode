namespace server.Application.Rooms;

public interface IRoomInvitationStore
{
    Task<bool> ValidateRoomAccessAsync(string roomId, string accessKey);
    Task<bool> HasRoomCreatorTokenAsync(string roomId);
    Task<bool> ValidateRoomCreatorTokenAsync(string roomId, string creatorToken);
}
