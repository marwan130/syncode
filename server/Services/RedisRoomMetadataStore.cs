using System.Security.Cryptography;
using System.Text.Json;
using StackExchange.Redis;
using server.Application.Projects;
using server.Application.Rooms;

namespace server.Services;

public sealed class RedisRoomMetadataStore :
    IRoomCreationStore,
    IRoomActivityStore,
    IRoomRecoveryStore,
    IRoomInvitationStore,
    IRoomLifecycleStore,
    IProjectRootNameStore,
    IProjectImportQuotaStore
{
    private const int RecoveryRetentionDays = 30;
    private static readonly JsonSerializerOptions RecoveryJsonOptions =
        new(JsonSerializerDefaults.Web) { PropertyNameCaseInsensitive = true };

    private const string BeginWorkspaceRestoreScript = """
        if redis.call('HGET', KEYS[1], 'recoveryOwnerRequestId') ~= ARGV[1] then return 0 end
        if redis.call('HGET', KEYS[1], 'recoveryImportStatus') ~= 'pending' then return 0 end
        redis.call('HSET', KEYS[1], 'recoveryImportStatus', 'running')
        return 1
        """;

    private const string FinishWorkspaceRestoreScript = """
        if redis.call('HGET', KEYS[1], 'recoveryOwnerRequestId') ~= ARGV[1] then return 0 end
        if redis.call('HGET', KEYS[1], 'recoveryImportStatus') ~= ARGV[2] then return 0 end
        redis.call('HSET', KEYS[1], 'recoveryImportStatus', ARGV[3])
        return 1
        """;

    private const string ReserveProjectImportBytesScript = """
        local current = tonumber(redis.call('GET', KEYS[1]) or '0')
        local incoming = tonumber(ARGV[1])
        local maximum = tonumber(ARGV[2])
        if incoming < 0 or current + incoming > maximum then return 0 end
        redis.call('INCRBY', KEYS[1], incoming)
        redis.call('EXPIRE', KEYS[1], 86400)
        return 1
        """;

    private const string ReplaceProjectImportBytesScript = """
        local incoming = tonumber(ARGV[1])
        local maximum = tonumber(ARGV[2])
        if incoming < 0 or incoming > maximum then return 0 end
        redis.call('SET', KEYS[1], incoming, 'EX', 86400)
        return 1
        """;

    private readonly IDatabase _db;
    public RedisRoomMetadataStore(IConnectionMultiplexer redis) =>
        _db = redis.GetDatabase();
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

    public async Task<bool> TryReplaceProjectImportBytesAsync(
        string roomId,
        long incomingBytes,
        long maximumBytes)
    {
        var result = await _db.ScriptEvaluateAsync(
            ReplaceProjectImportBytesScript,
            [RedisRoomKeys.ProjectImportBytes(roomId)],
            [incomingBytes, maximumBytes]);
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

    public async Task ArchiveExpiredRoomAsync(string roomId)
    {
        var meta = await _db.HashGetAllAsync(RedisRoomKeys.Meta(roomId));
        var accessKeyHash = (string?)meta.FirstOrDefault(entry => entry.Name == "accessKeyHash").Value;
        if (string.IsNullOrEmpty(accessKeyHash)) return;

        var approvedMembers = await _db.HashGetAllAsync(
            RedisRoomKeys.PreviousApprovedParticipants(roomId));
        var members = approvedMembers
            .Select(entry => JsonSerializer.Deserialize<PendingRoomJoinRequest>(
                (string)entry.Value!, RecoveryJsonOptions))
            .Where(member => member is
                { IsApproved: true, IsStableRequestId: true } &&
                IsValidRequestId(member.RequestId))
            .Select(member => new RecoveredRoomMember(
                member!.RequestId,
                member.IsAdmin,
                member.IsLocked))
            .ToArray();
        if (members.Length == 0) return;

        var recovery = new ExpiredRoomRecovery(
            accessKeyHash,
            (string?)meta.FirstOrDefault(entry => entry.Name == "creatorTokenHash").Value,
            (string?)meta.FirstOrDefault(entry => entry.Name == "projectRootName").Value,
            (string?)meta.FirstOrDefault(entry => entry.Name == "hasHadAdmin").Value == "1",
            members);
        await _db.StringSetAsync(
            RedisRoomKeys.Recovery(roomId),
            JsonSerializer.Serialize(recovery, RecoveryJsonOptions),
            TimeSpan.FromDays(RecoveryRetentionDays));
    }

    public async Task<bool> TryRestoreExpiredRoomAsync(
        string roomId,
        string accessKey,
        string? creatorToken,
        string? requestId)
    {
        if (!IsValidRoomId(roomId) || !IsValidRequestId(requestId)) return false;
        var metadataKey = RedisRoomKeys.Meta(roomId);
        if (await _db.KeyExistsAsync(metadataKey))
            return await _db.HashGetAsync(metadataKey, "recoveryOwnerRequestId") == requestId &&
                await _db.HashGetAsync(metadataKey, "recoveryImportStatus") == "pending";

        var recoveryJson = await _db.StringGetAsync(RedisRoomKeys.Recovery(roomId));
        if (recoveryJson.IsNullOrEmpty) return false;
        var recovery = JsonSerializer.Deserialize<ExpiredRoomRecovery>(
            (string)recoveryJson!, RecoveryJsonOptions);
        if (recovery is null || !MatchesHash(accessKey, recovery.AccessKeyHash)) return false;

        var isApprovedMember = recovery.Members.Any(member =>
            string.Equals(member.RequestId, requestId, StringComparison.Ordinal));
        var isCreator = !string.IsNullOrEmpty(creatorToken) &&
            recovery.CreatorTokenHash is not null &&
            MatchesHash(creatorToken, recovery.CreatorTokenHash);
        if (!isApprovedMember && !isCreator) return false;

        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString();
        var metadata = new List<HashEntry>
        {
            new("createdAt", now),
            new("lastActivity", now),
            new("accessKeyHash", recovery.AccessKeyHash),
            new("creatorTokenHash", recovery.CreatorTokenHash ?? string.Empty),
            new("hasHadAdmin", recovery.HasHadAdmin ? "1" : "0"),
            new("recoveryOwnerRequestId", requestId!),
            new("recoveryImportStatus", "pending"),
        };
        if (!string.IsNullOrWhiteSpace(recovery.ProjectRootName))
            metadata.Add(new HashEntry("projectRootName", recovery.ProjectRootName));

        var members = recovery.Members.Select(member => new HashEntry(
            member.RequestId,
            JsonSerializer.Serialize(new PendingRoomJoinRequest(
                member.RequestId,
                "Anonymous",
                "#38bdf8",
                null,
                string.Empty,
                true,
                true,
                member.IsAdmin,
                member.IsLocked), RecoveryJsonOptions))).ToArray();

        var transaction = _db.CreateTransaction();
        transaction.AddCondition(Condition.KeyNotExists(RedisRoomKeys.Meta(roomId)));
        _ = transaction.HashSetAsync(RedisRoomKeys.Meta(roomId), metadata.ToArray());
        _ = transaction.HashSetAsync(
            RedisRoomKeys.PreviousApprovedParticipants(roomId), members);
        _ = transaction.KeyDeleteAsync(RedisRoomKeys.Recovery(roomId));
        return await transaction.ExecuteAsync();
    }

    public async Task<bool> TryBeginWorkspaceRestoreAsync(string roomId, string requestId) =>
        (int)await _db.ScriptEvaluateAsync(
            BeginWorkspaceRestoreScript,
            [RedisRoomKeys.Meta(roomId)],
            [requestId]) == 1;

    public async Task<string?> GetWorkspaceRestoreStatusAsync(
        string roomId,
        string requestId)
    {
        var metadata = RedisRoomKeys.Meta(roomId);
        if (await _db.HashGetAsync(metadata, "recoveryOwnerRequestId") != requestId)
            return null;
        return (string?)await _db.HashGetAsync(metadata, "recoveryImportStatus");
    }

    public async Task CompleteWorkspaceRestoreAsync(string roomId, string requestId) =>
        await _db.ScriptEvaluateAsync(
            FinishWorkspaceRestoreScript,
            [RedisRoomKeys.Meta(roomId)],
            [requestId, "running", "complete"]);

    public async Task CancelWorkspaceRestoreAsync(string roomId, string requestId) =>
        await _db.ScriptEvaluateAsync(
            FinishWorkspaceRestoreScript,
            [RedisRoomKeys.Meta(roomId)],
            [requestId, "running", "pending"]);

    public async Task DeleteRoomAsync(string roomId)
    {
        var participants = await _db.HashKeysAsync(RedisRoomKeys.Participants(roomId));
        foreach (var connectionId in participants)
        {
            var connectionRoomKey = RedisRoomKeys.ConnectionRoom((string)connectionId!);
            if (await _db.StringGetAsync(connectionRoomKey) == roomId)
                await _db.KeyDeleteAsync(connectionRoomKey);
        }

        var endpoints = _db.Multiplexer.GetEndPoints();
        var patterns = new[] { $"room:{roomId}:*", $"room:{{{roomId}}}:*" };
        foreach (var endpoint in endpoints)
        {
            var server = _db.Multiplexer.GetServer(endpoint);
            foreach (var pattern in patterns)
            {
                var roomKeys = new List<RedisKey>();
                await foreach (var key in server.KeysAsync(pattern: pattern, pageSize: 500))
                    roomKeys.Add(key);
                foreach (var batch in roomKeys.Chunk(500))
                    await Task.WhenAll(batch.Select(roomKey => _db.KeyDeleteAsync(roomKey)));
            }
        }
        await _db.SetRemoveAsync(RedisRoomKeys.ActiveRooms, roomId);
    }

    public async Task<IEnumerable<string>> GetStaleRoomsAsync(TimeSpan threshold)
    {
        var cutoff = DateTimeOffset.UtcNow.Subtract(threshold).ToUnixTimeSeconds();
        var stale = new HashSet<string>(StringComparer.Ordinal);
        foreach (var endpoint in _db.Multiplexer.GetEndPoints())
        {
            var server = _db.Multiplexer.GetServer(endpoint);
            await foreach (var key in server.KeysAsync(pattern: "room:*:meta", pageSize: 500))
            {
                var lastActivityStr = (string?)await _db.HashGetAsync(key, "lastActivity");
                if (long.TryParse(lastActivityStr, out var lastActivity) && lastActivity < cutoff)
                {
                    var parts = ((string)key!).Split(':');
                    if (parts.Length >= 2) stale.Add(parts[1]);
                }
            }
        }

        return stale;
    }

    private static bool IsValidRequestId(string? requestId) =>
        requestId is { Length: 32 } && requestId.All(Uri.IsHexDigit);

    private static bool IsValidRoomId(string? roomId) =>
        roomId is { Length: 8 } && roomId.All(character =>
            character is >= 'a' and <= 'z' or >= '0' and <= '9');

    private static bool MatchesHash(string value, string expectedHash)
    {
        try
        {
            var suppliedHash = SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(value));
            return CryptographicOperations.FixedTimeEquals(
                suppliedHash,
                Convert.FromHexString(expectedHash));
        }
        catch (FormatException)
        {
            return false;
        }
    }

    private sealed record RecoveredRoomMember(
        string RequestId,
        bool IsAdmin,
        bool IsLocked);

    private sealed record ExpiredRoomRecovery(
        string AccessKeyHash,
        string? CreatorTokenHash,
        string? ProjectRootName,
        bool HasHadAdmin,
        IReadOnlyList<RecoveredRoomMember> Members);

}
