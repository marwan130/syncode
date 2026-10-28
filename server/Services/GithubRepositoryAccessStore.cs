using System.Security.Cryptography;
using System.Text;
using server.Application.Rooms;
using server.Models;
using StackExchange.Redis;

namespace server.Services;

public sealed class GithubRepositoryAccessStore(
    IConnectionMultiplexer redis,
    IRoomParticipantReader participants)
{
    private static readonly TimeSpan GrantLifetime = TimeSpan.FromMinutes(5);
    private readonly IDatabase _database = redis.GetDatabase();

    public async Task<string> CreateAdminGrantAsync(string roomId, string connectionId)
    {
        var participant = await participants.GetParticipantAsync(roomId, connectionId);
        if (participant?.IsAdmin != true || participant.IsLocked ||
            await participants.GetConnectionRoomAsync(connectionId) != roomId)
            throw new RoomOperationException("Only room admins can import a repository.");

        var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');
        await _database.StringSetAsync(
            RedisRoomKeys.GithubRepositoryAdminGrant(roomId, HashToken(token)),
            $"{roomId}\n{connectionId}",
            GrantLifetime);
        return token;
    }

    public async Task<string?> ValidateAdminGrantAsync(string? token, string roomId)
    {
        if (token is null || token.Length != 43 || !token.All(IsBase64UrlCharacter))
            return null;

        var key = RedisRoomKeys.GithubRepositoryAdminGrant(roomId, HashToken(token));
        var value = (string?)await _database.StringGetAsync(key);
        if (value is null) return null;

        var separator = value.IndexOf('\n');
        if (separator < 1 || value[..separator] != roomId) return null;
        var connectionId = value[(separator + 1)..];
        var participant = await participants.GetParticipantAsync(roomId, connectionId);
        if (participant?.IsAdmin != true || participant.IsLocked ||
            await participants.GetConnectionRoomAsync(connectionId) != roomId)
        {
            await _database.KeyDeleteAsync(key);
            return null;
        }

        return connectionId;
    }

    private static string HashToken(string token) => Convert.ToHexString(
        SHA256.HashData(Encoding.UTF8.GetBytes(token)));

    private static bool IsBase64UrlCharacter(char value) =>
        char.IsAsciiLetterOrDigit(value) || value is '-' or '_';
}
