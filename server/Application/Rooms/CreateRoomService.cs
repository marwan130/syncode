using System.Security.Cryptography;
using System.Text;

namespace server.Application.Rooms;

public sealed class CreateRoomService(IRoomCreationStore rooms)
{
    public async Task<RoomInvitation> CreateAsync()
    {
        var roomId = RandomNumberGenerator.GetString("abcdefghijklmnopqrstuvwxyz0123456789", 8);
        var accessKey = CreateSecret();
        var creatorToken = CreateSecret();
        await rooms.CreateRoomAsync(roomId, Hash(accessKey), Hash(creatorToken));
        return new RoomInvitation(roomId, accessKey, creatorToken);
    }

    private static string CreateSecret() => Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
        .TrimEnd('=')
        .Replace('+', '-')
        .Replace('/', '_');

    private static string Hash(string secret) => Convert.ToHexString(
        SHA256.HashData(Encoding.UTF8.GetBytes(secret)));
}
