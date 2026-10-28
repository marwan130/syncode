using System.Text.Json;
using StackExchange.Redis;
using server.Application.Rooms;

namespace server.Services;

public sealed class RedisRoomJoinApprovalStore(IConnectionMultiplexer redis) : IRoomJoinApprovalStore
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
        redis.call('SET', KEYS[2], '1', 'EX', 2592000)
        return value
        """;

    private const string GetApprovedMemberScript = """
        local value = redis.call('HGET', KEYS[1], ARGV[1])
        if not value then return false end
        local member = cjson.decode(value)
        if not member.IsApproved then return false end
        member.ConnectionId = ARGV[2]
        local updated = cjson.encode(member)
        redis.call('HSET', KEYS[1], ARGV[1], updated)
        return updated
        """;

    private const string IsApprovedRequestScript = """
        local value = redis.call('HGET', KEYS[1], ARGV[1])
        if not value then return 0 end
        local request = cjson.decode(value)
        if request.IsApproved then
            request.ConnectionId = ARGV[2]
            redis.call('HSET', KEYS[1], ARGV[1], cjson.encode(request))
            return 1
        end
        return 0
        """;

    private const string HasApprovedAdminScript = """
        for _, value in ipairs(redis.call('HVALS', KEYS[1])) do
            local member = cjson.decode(value)
            if member.IsApproved and member.IsAdmin then return 1 end
        end
        return 0
        """;

    private const string SaveMemberScript = """
        local value = redis.call('HGET', KEYS[1], ARGV[1])
        local member
        if value then
            member = cjson.decode(value)
        else
            member = {
                RequestId = ARGV[1],
                DisplayName = ARGV[3],
                Color = ARGV[4],
                AvatarUrl = cjson.null,
                IsStableRequestId = true
            }
        end
        member.ConnectionId = ARGV[2]
        member.DisplayName = ARGV[3]
        member.Color = ARGV[4]
        member.AvatarUrl = ARGV[5] == '' and cjson.null or ARGV[5]
        member.IsApproved = true
        member.IsStableRequestId = true
        member.IsAdmin = ARGV[6] == '1'
        member.IsLocked = ARGV[7] == '1' and not member.IsAdmin
        redis.call('HSET', KEYS[1], ARGV[1], cjson.encode(member))
        return 1
        """;

    private const string RemoveMemberScript = """
        redis.call('HDEL', KEYS[1], ARGV[1])
        return 1
        """;

    private const string UpdateMemberRoleScript = """
        local value = redis.call('HGET', KEYS[1], ARGV[1])
        if not value then return 0 end
        local member = cjson.decode(value)
        member.IsAdmin = ARGV[2] == '1'
        if member.IsAdmin then member.IsLocked = false end
        redis.call('HSET', KEYS[1], ARGV[1], cjson.encode(member))
        return 1
        """;

    private const string UpdateMemberLockScript = """
        local value = redis.call('HGET', KEYS[1], ARGV[1])
        if not value then return 0 end
        local member = cjson.decode(value)
        member.IsLocked = ARGV[2] == '1'
        redis.call('HSET', KEYS[1], ARGV[1], cjson.encode(member))
        return 1
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
            if request.IsApproved == nil or request.IsStableRequestId ~= true then
                redis.call('HDEL', KEYS[1], entries[index])
            end
        end
        return 1
        """;

    private readonly IDatabase _db = redis.GetDatabase();
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

    public async Task<PendingRoomJoinRequest?> GetApprovedMemberAsync(
        string roomId,
        string requestId,
        string connectionId)
    {
        if (!IsValidRequestId(requestId)) return null;
        var value = await _db.ScriptEvaluateAsync(
            GetApprovedMemberScript,
            [RedisRoomKeys.PreviousApprovedParticipants(roomId)],
            [requestId, connectionId]);
        return value.IsNull
            ? null
            : JsonSerializer.Deserialize<PendingRoomJoinRequest>((string)value!, JsonOptions);
    }

    public async Task<bool> HasApprovedAdminAsync(string roomId) =>
        (int)await _db.ScriptEvaluateAsync(
            HasApprovedAdminScript,
            [RedisRoomKeys.PreviousApprovedParticipants(roomId)]) == 1;

    public async Task<bool> IsApprovedRequestAsync(string roomId, string requestId, string connectionId)
    {
        if (!IsValidRequestId(requestId)) return false;
        return (int)await _db.ScriptEvaluateAsync(
            IsApprovedRequestScript,
            [RedisRoomKeys.PendingJoinRequests(roomId)],
            [requestId, connectionId]) == 1;
    }

    public async Task SaveMemberAsync(
        string roomId,
        string requestId,
        string connectionId,
        string displayName,
        string color,
        string? avatarUrl,
        bool isAdmin,
        bool isLocked)
    {
        if (!IsValidRequestId(requestId)) return;
        await _db.ScriptEvaluateAsync(
            SaveMemberScript,
            [RedisRoomKeys.PreviousApprovedParticipants(roomId)],
            [requestId, connectionId, displayName, color, avatarUrl ?? string.Empty, isAdmin ? "1" : "0", isLocked ? "1" : "0"]);
    }

    public async Task RemoveMemberAsync(string roomId, string requestId)
    {
        if (!IsValidRequestId(requestId)) return;
        await _db.ScriptEvaluateAsync(
            RemoveMemberScript,
            [RedisRoomKeys.PreviousApprovedParticipants(roomId)],
            [requestId]);
    }

    public async Task UpdateMemberAdminAsync(string roomId, string requestId, bool isAdmin)
    {
        if (!IsValidRequestId(requestId)) return;
        await _db.ScriptEvaluateAsync(
            UpdateMemberRoleScript,
            [RedisRoomKeys.PreviousApprovedParticipants(roomId)],
            [requestId, isAdmin ? "1" : "0"]);
    }

    public async Task UpdateMemberLockAsync(string roomId, string requestId, bool isLocked)
    {
        if (!IsValidRequestId(requestId)) return;
        await _db.ScriptEvaluateAsync(
            UpdateMemberLockScript,
            [RedisRoomKeys.PreviousApprovedParticipants(roomId)],
            [requestId, isLocked ? "1" : "0"]);
    }

    public async Task<bool> IsRejectedAsync(string roomId, string requestId) =>
        await _db.KeyExistsAsync(RedisRoomKeys.RejectedJoinRequest(roomId, requestId));

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
            false,
            true);
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
            [RedisRoomKeys.PendingJoinRequests(roomId), RedisRoomKeys.RejectedJoinRequest(roomId, requestId)],
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
