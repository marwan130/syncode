using System.Text.Json;
using StackExchange.Redis;

namespace server.Services;

public sealed record PendingRoomJoinRequest(
    string RequestId,
    string DisplayName,
    string Color,
    string? AvatarUrl,
    string ConnectionId,
    bool IsApproved);

public sealed record RoomJoinRequestView(
    string RequestId,
    string DisplayName,
    string Color,
    string? AvatarUrl);

public sealed class RedisRoomJoinApprovalStore(IConnectionMultiplexer redis)
{
    private const string ApproveScript = """
        local value = redis.call('HGET', KEYS[1], ARGV[1])
        if not value then return false end
        local request = cjson.decode(value)
        if request.IsApproved then return false end
        request.IsApproved = true
        local updated = cjson.encode(request)
        redis.call('HSET', KEYS[1], ARGV[1], updated)
        return updated
        """;

    private const string RejectScript = """
        local value = redis.call('HGET', KEYS[1], ARGV[1])
        if not value then return false end
        local request = cjson.decode(value)
        if request.IsApproved then return false end
        redis.call('HDEL', KEYS[1], ARGV[1])
        return value
        """;

    private const string IsApprovedScript = """
        local value = redis.call('HGET', KEYS[1], ARGV[1])
        if not value then return 0 end
        local request = cjson.decode(value)
        if request.ConnectionId == ARGV[2] and request.IsApproved then return 1 end
        return 0
        """;

    private const string RemoveRequestScript = """
        local value = redis.call('HGET', KEYS[1], ARGV[1])
        if not value then return 0 end
        local request = cjson.decode(value)
        if request.ConnectionId ~= ARGV[2] then return 0 end
        redis.call('HDEL', KEYS[1], ARGV[1])
        return 1
        """;

    private const string UpsertRequestScript = """
        local exists = redis.call('HEXISTS', KEYS[1], ARGV[1]) == 1
        if not exists and redis.call('HLEN', KEYS[1]) >= tonumber(ARGV[3]) then return 0 end
        redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
        return 1
        """;

    private const string PruneLegacyRequestsScript = """
        local entries = redis.call('HGETALL', KEYS[1])
        for index = 1, #entries, 2 do
            local request = cjson.decode(entries[index + 1])
            if request.IsApproved == nil then redis.call('HDEL', KEYS[1], entries[index]) end
        end
        return 1
        """;

    private readonly IDatabase _db = redis.GetDatabase();
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

    public async Task<bool> IsApprovedAsync(string roomId, string requestId, string connectionId) =>
        (int)await _db.ScriptEvaluateAsync(
            IsApprovedScript,
            [RedisRoomKeys.PendingJoinRequests(roomId)],
            [requestId, connectionId]) == 1;

    public async Task<bool> HasHadAdminAsync(string roomId) =>
        await _db.HashGetAsync(RedisRoomKeys.Meta(roomId), "hasHadAdmin") == "1";

    public async Task<bool> UpsertRequestAsync(
        string roomId,
        string requestId,
        string connectionId,
        string displayName,
        string color,
        string? avatarUrl,
        int maxPendingRequests)
    {
        await PruneLegacyRequestsAsync(roomId);
        var request = new PendingRoomJoinRequest(
            requestId,
            displayName,
            color,
            avatarUrl,
            connectionId,
            false);
        var result = await _db.ScriptEvaluateAsync(
            UpsertRequestScript,
            [RedisRoomKeys.PendingJoinRequests(roomId)],
            [requestId, JsonSerializer.Serialize(request), maxPendingRequests]);
        return (int)result == 1;
    }

    public async Task<IReadOnlyList<RoomJoinRequestView>> GetRequestsAsync(string roomId)
    {
        await PruneLegacyRequestsAsync(roomId);
        var values = await _db.HashValuesAsync(RedisRoomKeys.PendingJoinRequests(roomId));
        return values
            .Select(value => JsonSerializer.Deserialize<PendingRoomJoinRequest>((string)value!, JsonOptions))
            .Where(request => request is { IsApproved: false })
            .Select(request => new RoomJoinRequestView(
                request!.RequestId,
                request.DisplayName,
                request.Color,
                request.AvatarUrl))
            .ToArray();
    }

    public async Task<PendingRoomJoinRequest?> ApproveAsync(string roomId, string requestId)
    {
        if (!IsValidRequestId(requestId)) return null;
        var value = await _db.ScriptEvaluateAsync(
            ApproveScript,
            [RedisRoomKeys.PendingJoinRequests(roomId)],
            [requestId]);
        return value.IsNull
            ? null
            : JsonSerializer.Deserialize<PendingRoomJoinRequest>((string)value!, JsonOptions);
    }

    public async Task<PendingRoomJoinRequest?> RejectAsync(string roomId, string requestId)
    {
        if (!IsValidRequestId(requestId)) return null;
        var value = await _db.ScriptEvaluateAsync(
            RejectScript,
            [RedisRoomKeys.PendingJoinRequests(roomId)],
            [requestId]);
        return value.IsNull
            ? null
            : JsonSerializer.Deserialize<PendingRoomJoinRequest>((string)value!, JsonOptions);
    }

    public async Task RemoveRequestAsync(string roomId, string requestId, string connectionId)
    {
        if (!IsValidRequestId(requestId)) return;
        await _db.ScriptEvaluateAsync(
            RemoveRequestScript,
            [RedisRoomKeys.PendingJoinRequests(roomId)],
            [requestId, connectionId]);
    }

    private async Task PruneLegacyRequestsAsync(string roomId)
    {
        await _db.ScriptEvaluateAsync(
            PruneLegacyRequestsScript,
            [RedisRoomKeys.PendingJoinRequests(roomId)]);
    }

    private static bool IsValidRequestId(string requestId) =>
        requestId.Length == 32 && requestId.All(Uri.IsHexDigit);
}
