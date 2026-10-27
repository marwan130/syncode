using System.Security.Cryptography;
using StackExchange.Redis;
using server.Application.Projects;
using server.Application.Rooms;

namespace server.Services;

public sealed class RedisRoomMetadataStore :
    IRoomCreationStore,
    IRoomActivityStore,
    IRoomInvitationStore,
    IProjectRootNameStore,
    IProjectImportQuotaStore
{
    private const string ReserveProjectImportBytesScript = """
        local current = tonumber(redis.call('GET', KEYS[1]) or '0')
        local incoming = tonumber(ARGV[1])
        local maximum = tonumber(ARGV[2])
        if incoming < 0 or current + incoming > maximum then return 0 end
        redis.call('INCRBY', KEYS[1], incoming)
        redis.call('EXPIRE', KEYS[1], 86400)
        return 1
        """;

    private readonly IDatabase _db;
    private readonly RedisProjectTreeStore treeStore;
    private readonly IProjectTreeStateReader projectTreeState;

    public RedisRoomMetadataStore(
        IConnectionMultiplexer redis,
        RedisProjectTreeStore projectTreeStore,
        IProjectTreeStateReader projectTreeState)
    {
        _db = redis.GetDatabase();
        treeStore = projectTreeStore;
        this.projectTreeState = projectTreeState;
    }
    public async Task CreateRoomAsync(
        string roomId,
        string accessKeyHash,
        string creatorTokenHash)
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString();
        var metaKey = RedisRoomKeys.Meta(roomId);

        await _db.HashSetAsync(metaKey, [
            new HashEntry("createdAt", now),
            new HashEntry("lastActivity", now),
            new HashEntry("accessKeyHash", accessKeyHash),
            new HashEntry("creatorTokenHash", creatorTokenHash),
        ]);
    }

    public async Task<bool> ValidateRoomCreatorTokenAsync(
        string roomId,
        string creatorToken)
    {
        if (string.IsNullOrEmpty(roomId) || roomId.Length != 8 ||
            string.IsNullOrEmpty(creatorToken) || creatorToken.Length != 43 ||
            !creatorToken.All(character =>
                char.IsAsciiLetterOrDigit(character) || character is '-' or '_'))
            return false;

        var storedHash = (string?)await _db.HashGetAsync(RedisRoomKeys.Meta(roomId), "creatorTokenHash");
        if (storedHash is null) return false;

        var suppliedHash = SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(creatorToken));
        return CryptographicOperations.FixedTimeEquals(
            suppliedHash,
            Convert.FromHexString(storedHash));
    }

    public async Task<bool> HasRoomCreatorTokenAsync(string roomId) =>
        await _db.HashExistsAsync(RedisRoomKeys.Meta(roomId), "creatorTokenHash");

    public async Task<bool> TryReserveProjectImportBytesAsync(
        string roomId,
        long snapshotBytes,
        long maximumBytes)
    {
        var result = await _db.ScriptEvaluateAsync(
            ReserveProjectImportBytesScript,
            [RedisRoomKeys.ProjectImportBytes(roomId)],
            [snapshotBytes, maximumBytes]);
        return (int)result == 1;
    }

    public async Task<bool> ValidateRoomAccessAsync(string roomId, string accessKey)
    {
        if (string.IsNullOrEmpty(roomId) ||
            roomId.Length != 8 ||
            !roomId.All(character =>
                character is >= 'a' and <= 'z' or >= '0' and <= '9') ||
            !IsValidAccessKey(accessKey))
        {
            return false;
        }

        var storedHash = (string?)await _db.HashGetAsync(RedisRoomKeys.Meta(roomId), "accessKeyHash");
        if (storedHash is null) return false;

        var suppliedHash = SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(accessKey));
        var expectedHash = Convert.FromHexString(storedHash);
        return CryptographicOperations.FixedTimeEquals(suppliedHash, expectedHash);
    }

    private static bool IsValidAccessKey(string accessKey)
    {
        if (string.IsNullOrEmpty(accessKey)) return false;

        var isLegacyHex = accessKey.Length == 64 && accessKey.All(Uri.IsHexDigit);
        var isBase64Url = accessKey.Length == 43 && accessKey.All(character =>
            character is >= 'A' and <= 'Z' or >= 'a' and <= 'z' or
                >= '0' and <= '9' or '-' or '_');

        return isLegacyHex || isBase64Url;
    }

    public async Task TouchRoomAsync(string roomId)
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString();
        await _db.HashSetAsync(RedisRoomKeys.Meta(roomId), "lastActivity", now);
    }

    public async Task<string?> GetProjectRootNameAsync(string roomId)
    {
        var name = (string?)await _db.HashGetAsync(RedisRoomKeys.Meta(roomId), "projectRootName");
        return string.IsNullOrWhiteSpace(name) ? null : name;
    }

    public Task SetProjectRootNameAsync(string roomId, string name) =>
        _db.HashSetAsync(RedisRoomKeys.Meta(roomId), "projectRootName", name);

    public async Task DeleteRoomAsync(string roomId)
    {
        var fileIds = await _db.HashKeysAsync(RedisRoomKeys.Files(roomId));
        var projectFileIds = await projectTreeState.GetFileIdsAsync(roomId);
        var projectTreeKeys = await treeStore.GetRoomDeletionKeysAsync(roomId, projectFileIds);
        var keys = new RedisKey[] {
            RedisRoomKeys.Meta(roomId), RedisRoomKeys.Participants(roomId), RedisRoomKeys.PreviousApprovedParticipants(roomId), RedisRoomKeys.PreviousParticipantIdentities(roomId), RedisRoomKeys.PendingJoinRequests(roomId), RedisRoomKeys.Snapshot(roomId), RedisRoomKeys.Chat(roomId), RedisRoomKeys.Files(roomId),
            RedisRoomKeys.GithubRepository(roomId),
            RedisRoomKeys.GithubRepositoryPushLock(roomId),
        }.Concat(fileIds.Select(id => (string)id!).Concat(projectFileIds)
            .Distinct().Select(id => (RedisKey)RedisRoomKeys.FileSnapshot(roomId, id)))
            .Concat(projectTreeKeys).ToArray();
        await _db.KeyDeleteAsync(keys);
        await _db.SetRemoveAsync(RedisRoomKeys.ActiveRooms, roomId);
    }

    public async Task<IEnumerable<string>> GetStaleRoomsAsync(TimeSpan threshold)
    {
        var server = _db.Multiplexer.GetServer(_db.Multiplexer.GetEndPoints().First());
        var cutoff = DateTimeOffset.UtcNow.Subtract(threshold).ToUnixTimeSeconds();
        var stale = new List<string>();

        await foreach (var key in server.KeysAsync(pattern: "room:*:meta"))
        {
            var lastActivityStr = (string?)await _db.HashGetAsync(key, "lastActivity");
            if (long.TryParse(lastActivityStr, out var lastActivity) && lastActivity < cutoff)
            {
                var parts = ((string)key!).Split(':');
                if (parts.Length >= 2) stale.Add(parts[1]);
            }
        }

        return stale;
    }

}
