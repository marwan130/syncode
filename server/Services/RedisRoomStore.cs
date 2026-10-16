using System.Text.Json;
using System.Security.Cryptography;
using server.Models;
using StackExchange.Redis;

namespace server.Services;

public class RedisRoomStore
{
    public sealed record RoomEntry(string Id, string Name, string? ParentId, bool IsFolder);
    private const int ChatHistoryLimit = 100;
    private const string ConsumeRateLimitScript = """
        local now = tonumber(ARGV[1])
        local member = ARGV[2]
        for i, key in ipairs(KEYS) do
            local limit = tonumber(ARGV[(i - 1) * 2 + 3])
            local window = tonumber(ARGV[(i - 1) * 2 + 4])
            redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
            if redis.call('ZCARD', key) >= limit then
                return 0
            end
        end
        for i, key in ipairs(KEYS) do
            redis.call('ZADD', key, now, member)
            local window = tonumber(ARGV[(i - 1) * 2 + 4])
            redis.call('PEXPIRE', key, window + 1000)
        end
        return 1
        """;
    private const string AppendChatMessageScript = """
        redis.call('RPUSH', KEYS[1], ARGV[1])
        redis.call('LTRIM', KEYS[1], -100, -1)
        return 1
        """;
    private const string CreateRoomEntryScript = """
        local files = redis.call('HVALS', KEYS[1])
        for _, value in ipairs(files) do
            local file = cjson.decode(value)
            local name = file.name or file.Name
            local parent = file.parentId
            if parent == nil or parent == cjson.null then parent = file.ParentId end
            if parent == nil or parent == cjson.null then parent = '' end
            if parent == ARGV[2] and string.lower(name) == string.lower(ARGV[3]) then return 0 end
        end
        redis.call('HSET', KEYS[1], ARGV[1], ARGV[4])
        return 1
        """;
    private const string RenameRoomEntryScript = """
        if redis.call('HEXISTS', KEYS[1], ARGV[1]) == 0 then return 0 end
        local current = cjson.decode(redis.call('HGET', KEYS[1], ARGV[1]))
        local parent = current.parentId
        if parent == nil or parent == cjson.null then parent = current.ParentId end
        if parent == nil or parent == cjson.null then parent = '' end
        local files = redis.call('HVALS', KEYS[1])
        for _, value in ipairs(files) do
            local file = cjson.decode(value)
            local id = file.id or file.Id
            local itemParent = file.parentId
            if itemParent == nil or itemParent == cjson.null then itemParent = file.ParentId end
            if itemParent == nil or itemParent == cjson.null then itemParent = '' end
            local name = file.name or file.Name
            if id ~= ARGV[1] and itemParent == parent and string.lower(name) == string.lower(ARGV[2]) then return -1 end
        end
        redis.call('HSET', KEYS[1], ARGV[1], ARGV[3])
        return 1
        """;
    private const string DeleteRoomEntryScript = """
        local values = redis.call('HVALS', KEYS[1])
        local entries = {}
        local totalFiles = 0
        for _, value in ipairs(values) do
            local entry = cjson.decode(value)
            local id = entry.id or entry.Id
            local folder = entry.isFolder or entry.IsFolder or false
            entries[id] = { data = entry, folder = folder, parent = entry.parentId or entry.ParentId or '' }
            if not folder then totalFiles = totalFiles + 1 end
        end
        if not entries[ARGV[1]] then return {0} end
        local removed = {}
        local function collect(id)
            table.insert(removed, id)
            for childId, child in pairs(entries) do
                if child.parent == id then collect(childId) end
            end
        end
        collect(ARGV[1])
        local removedFiles = 0
        for _, id in ipairs(removed) do
            if not entries[id].folder then removedFiles = removedFiles + 1 end
        end
        if totalFiles - removedFiles < 1 then return {-1} end
        local result = {1}
        for _, id in ipairs(removed) do
            redis.call('HDEL', KEYS[1], id)
            if not entries[id].folder then redis.call('DEL', KEYS[2] .. id .. ':snapshot') end
            table.insert(result, id)
        end
        return result
        """;
    private const string AdmitParticipantScript = """
        if redis.call('EXISTS', KEYS[2]) == 0 then return -1 end
        local alreadyInRoom = redis.call('HEXISTS', KEYS[1], ARGV[1]) == 1
        if not alreadyInRoom then
            if redis.call('HLEN', KEYS[1]) >= tonumber(ARGV[4]) then return 0 end
            local roomIsActive = redis.call('SISMEMBER', KEYS[3], ARGV[5]) == 1
            if not roomIsActive and redis.call('SCARD', KEYS[3]) >= tonumber(ARGV[6]) then return -2 end
            local connectionExists = redis.call('SISMEMBER', KEYS[4], ARGV[1]) == 1
            if not connectionExists and redis.call('SCARD', KEYS[4]) >= tonumber(ARGV[7]) then return -3 end
        end
        local participant = cjson.decode(ARGV[2])
        if alreadyInRoom then
            local previous = cjson.decode(redis.call('HGET', KEYS[1], ARGV[1]))
            participant.IsAdmin = previous.IsAdmin or previous.isAdmin or false
            participant.IsLocked = previous.IsLocked or previous.isLocked or false
        else
            local hasAdmin = false
            for _, value in ipairs(redis.call('HVALS', KEYS[1])) do
                local existing = cjson.decode(value)
                if existing.IsAdmin or existing.isAdmin then
                    hasAdmin = true
                    break
                end
            end
            if not hasAdmin then
                participant.IsAdmin = true
                participant.IsLocked = false
            end
        end
        redis.call('HSET', KEYS[1], ARGV[1], cjson.encode(participant))
        redis.call('SADD', KEYS[3], ARGV[5])
        redis.call('SADD', KEYS[4], ARGV[1])
        redis.call('PEXPIRE', KEYS[4], 120000)
        redis.call('SET', KEYS[5], ARGV[5], 'EX', 86400)
        return 1
        """;
    private const string RemoveParticipantScript = """
        redis.call('HDEL', KEYS[1], ARGV[1])
        if redis.call('GET', KEYS[3]) == ARGV[2] then
            redis.call('DEL', KEYS[3])
            redis.call('SREM', KEYS[4], ARGV[1])
        end
        if redis.call('HLEN', KEYS[1]) == 0 then
            redis.call('SREM', KEYS[2], ARGV[2])
        end
        return 1
        """;
    private const string ToggleParticipantLockScript = """
        local actorValue = redis.call('HGET', KEYS[1], ARGV[1])
        if not actorValue then return '-2' end
        local actor = cjson.decode(actorValue)
        if not (actor.IsAdmin or actor.isAdmin) then return '-2' end

        local value = redis.call('HGET', KEYS[1], ARGV[2])
        if not value then return '0' end
        local participant = cjson.decode(value)
        if participant.IsAdmin or participant.isAdmin then return '-1' end
        local locked = participant.IsLocked or participant.isLocked or false
        participant.IsLocked = not locked
        local updated = cjson.encode(participant)
        redis.call('HSET', KEYS[1], ARGV[2], updated)
        return updated
        """;
    private const string UpdateParticipantColorScript = """
        local value = redis.call('HGET', KEYS[1], ARGV[1])
        if not value then return '0' end
        local participant = cjson.decode(value)
        participant.Color = ARGV[2]
        local updated = cjson.encode(participant)
        redis.call('HSET', KEYS[1], ARGV[1], updated)
        return updated
        """;
    private const string SetParticipantAdminScript = """
        local actorValue = redis.call('HGET', KEYS[1], ARGV[1])
        if not actorValue then return '-1' end
        local actor = cjson.decode(actorValue)
        if not (actor.IsAdmin or actor.isAdmin) then return '-1' end

        local targetValue = redis.call('HGET', KEYS[1], ARGV[2])
        if not targetValue then return '0' end
        local target = cjson.decode(targetValue)
        target.IsAdmin = ARGV[3] == '1'
        if target.IsAdmin then target.IsLocked = false end
        local updated = cjson.encode(target)
        redis.call('HSET', KEYS[1], ARGV[2], updated)
        return updated
        """;
    private const string RegisterConnectionScript = """
        if redis.call('SISMEMBER', KEYS[1], ARGV[1]) == 1 then return 1 end
        if redis.call('SCARD', KEYS[1]) >= tonumber(ARGV[2]) then return 0 end
        redis.call('SADD', KEYS[1], ARGV[1])
        redis.call('PEXPIRE', KEYS[1], 120000)
        return 1
        """;

    private static readonly JsonSerializerOptions _jsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    private readonly IDatabase _db;

    public RedisRoomStore(IConnectionMultiplexer redis)
    {
        _db = redis.GetDatabase();
    }

    public async Task CreateRoomAsync(string roomId, string accessKeyHash)
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString();
        var metaKey = MetaKey(roomId);

        await _db.HashSetAsync(metaKey, [
            new HashEntry("createdAt", now),
            new HashEntry("lastActivity", now),
            new HashEntry("accessKeyHash", accessKeyHash),
        ]);
        await _db.HashSetAsync(FilesKey(roomId), "main.cpp", JsonSerializer.Serialize(new RoomEntry("main.cpp", "main.cpp", null, false)));
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

        var storedHash = (string?)await _db.HashGetAsync(MetaKey(roomId), "accessKeyHash");
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
        await _db.HashSetAsync(MetaKey(roomId), "lastActivity", now);
    }

    public async Task DeleteRoomAsync(string roomId)
    {
        var fileIds = await _db.HashKeysAsync(FilesKey(roomId));
        var keys = new RedisKey[] {
            MetaKey(roomId),
            ParticipantsKey(roomId),
            SnapshotKey(roomId),
            ChatKey(roomId),
            FilesKey(roomId),
        }.Concat(fileIds.Select(id => (RedisKey)FileSnapshotKey(roomId, (string)id!))).ToArray();
        await _db.KeyDeleteAsync(keys);
        await _db.SetRemoveAsync(ActiveRoomsKey, roomId);
    }

    public async Task AppendChatMessageAsync(string roomId, ChatMessage message)
    {
        await _db.ScriptEvaluateAsync(
            AppendChatMessageScript,
            [ChatKey(roomId)],
            [JsonSerializer.Serialize(message)]);
    }

    public async Task<bool> TryConsumeChatRateLimitAsync(
        string roomId,
        string connectionId,
        string messageId)
    {
        return await TryConsumeRateLimitAsync(
            [
                ChatConnectionRateKey(roomId, connectionId, "10s"),
                ChatConnectionRateKey(roomId, connectionId, "1m"),
                ChatRoomRateKey(roomId, "10s"),
                ChatRoomRateKey(roomId, "1m"),
            ],
            messageId,
            connectionBurstLimit: 10,
            connectionMinuteLimit: 60,
            roomBurstLimit: 100,
            roomMinuteLimit: 500);
    }

    public async Task<bool> TryConsumeFileEntryCreateRateLimitAsync(
        string roomId,
        string connectionId,
        string operationId) =>
        await TryConsumeRateLimitAsync(
            [
                FileEntryCreateConnectionRateKey(roomId, connectionId, "10s"),
                FileEntryCreateConnectionRateKey(roomId, connectionId, "1m"),
                FileEntryCreateRoomRateKey(roomId, "10s"),
                FileEntryCreateRoomRateKey(roomId, "1m"),
            ],
            operationId,
            connectionBurstLimit: 20,
            connectionMinuteLimit: 120,
            roomBurstLimit: 200,
            roomMinuteLimit: 500);

    private async Task<bool> TryConsumeRateLimitAsync(
        RedisKey[] keys,
        string operationId,
        int connectionBurstLimit,
        int connectionMinuteLimit,
        int roomBurstLimit,
        int roomMinuteLimit)
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var result = await _db.ScriptEvaluateAsync(
            ConsumeRateLimitScript,
            keys,
            [
                now,
                operationId,
                connectionBurstLimit,
                10_000,
                connectionMinuteLimit,
                60_000,
                roomBurstLimit,
                10_000,
                roomMinuteLimit,
                60_000,
            ]);
        return (int)result == 1;
    }

    public async Task<IReadOnlyList<ChatMessage>> GetChatMessagesAsync(string roomId)
    {
        var entries = await _db.ListRangeAsync(ChatKey(roomId), -ChatHistoryLimit, -1);
        return entries
            .Select(entry => JsonSerializer.Deserialize<ChatMessage>((string)entry!, _jsonOptions))
            .Where(message => message is not null)
            .Select(message => message!)
            .ToArray();
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

    public async Task PruneInactiveRoomsAsync()
    {
        var activeRooms = await _db.SetMembersAsync(ActiveRoomsKey);
        foreach (var roomId in activeRooms)
            await GetParticipantsAsync((string)roomId!);
    }

    public async Task<int> TryAdmitParticipantAsync(
        string roomId,
        Participant participant,
        string instanceId,
        int maxParticipants,
        int maxActiveRooms,
        int maxConnections)
    {
        return (int)await _db.ScriptEvaluateAsync(
            AdmitParticipantScript,
            [ParticipantsKey(roomId), MetaKey(roomId), ActiveRoomsKey, InstanceConnectionsKey(instanceId), ConnectionRoomKey(participant.ConnectionId)],
            [participant.ConnectionId, JsonSerializer.Serialize(participant), instanceId, maxParticipants, roomId, maxActiveRooms, maxConnections]);
    }

    public async Task<bool> TryRegisterConnectionAsync(string connectionId, string instanceId, int maxConnections) =>
        (int)await _db.ScriptEvaluateAsync(
            RegisterConnectionScript,
            [InstanceConnectionsKey(instanceId)],
            [connectionId, maxConnections]) == 1;

    public async Task UnregisterConnectionAsync(string connectionId, string instanceId) =>
        await _db.SetRemoveAsync(InstanceConnectionsKey(instanceId), connectionId);

    public async Task RefreshInstanceConnectionLeaseAsync(string instanceId) =>
        await _db.KeyExpireAsync(InstanceConnectionsKey(instanceId), TimeSpan.FromMinutes(2));

    public async Task RemoveParticipantAsync(string roomId, string connectionId, string instanceId) =>
        await _db.ScriptEvaluateAsync(
            RemoveParticipantScript,
            [ParticipantsKey(roomId), ActiveRoomsKey, ConnectionRoomKey(connectionId), InstanceConnectionsKey(instanceId)],
            [connectionId, roomId]);

    public async Task<(int Status, Participant? Participant)> ToggleParticipantLockedAsync(
        string roomId,
        string actorConnectionId,
        string targetConnectionId)
    {
        var result = await _db.ScriptEvaluateAsync(
            ToggleParticipantLockScript,
            [ParticipantsKey(roomId)],
            [actorConnectionId, targetConnectionId]);
        var value = (string?)result;
        if (int.TryParse(value, out var status)) return (status, null);
        var participant = JsonSerializer.Deserialize<Participant>(value!, _jsonOptions);
        return participant is null ? (0, null) : (1, participant);
    }

    public async Task<Participant?> UpdateParticipantColorAsync(
        string roomId,
        string connectionId,
        string color)
    {
        var result = await _db.ScriptEvaluateAsync(
            UpdateParticipantColorScript,
            [ParticipantsKey(roomId)],
            [connectionId, color]);
        var value = (string?)result;
        return string.IsNullOrEmpty(value) || value == "0"
            ? null
            : JsonSerializer.Deserialize<Participant>(value, _jsonOptions);
    }

    public async Task<(int Status, Participant? Participant)> SetParticipantAdminAsync(
        string roomId,
        string actorConnectionId,
        string targetConnectionId,
        bool isAdmin)
    {
        var result = await _db.ScriptEvaluateAsync(
            SetParticipantAdminScript,
            [ParticipantsKey(roomId)],
            [actorConnectionId, targetConnectionId, isAdmin ? "1" : "0"]);
        var value = (string?)result;
        if (int.TryParse(value, out var status)) return (status, null);
        var participant = JsonSerializer.Deserialize<Participant>(value!, _jsonOptions);
        return participant is null ? (0, null) : (1, participant);
    }

    public async Task<bool> IsParticipantAsync(string roomId, string connectionId) =>
        await _db.HashExistsAsync(ParticipantsKey(roomId), connectionId);

    public async Task<IReadOnlyList<Participant>> GetParticipantsAsync(string roomId)
    {
        var entries = await _db.HashGetAllAsync(ParticipantsKey(roomId));
        if (entries.Length == 0)
            await _db.SetRemoveAsync(ActiveRoomsKey, roomId);
        var participants = new List<Participant>();

        foreach (var entry in entries)
        {
            var p = JsonSerializer.Deserialize<Participant>((string)entry.Value!, _jsonOptions);
            if (p is null) continue;
            var isLive = !string.IsNullOrEmpty(p.InstanceId) &&
                await _db.SetContainsAsync(InstanceConnectionsKey(p.InstanceId), p.ConnectionId);
            if (isLive) participants.Add(p);
            else await RemoveParticipantAsync(roomId, p.ConnectionId, p.InstanceId);
        }

        return participants;
    }

    public async Task<Participant?> GetParticipantAsync(string roomId, string connectionId)
    {
        var json = await _db.HashGetAsync(ParticipantsKey(roomId), connectionId);
        return json.IsNullOrEmpty
            ? null
            : JsonSerializer.Deserialize<Participant>((string)json!, _jsonOptions);
    }

    public async Task<string?> GetUserRoomAsync(string userId)
    {
        if (string.IsNullOrEmpty(userId)) return null;
        var val = (string?)await _db.StringGetAsync(UserRoomKey(userId));
        return val;
    }

    public async Task<string?> GetConnectionRoomAsync(string connectionId)
    {
        if (string.IsNullOrEmpty(connectionId)) return null;
        return (string?)await _db.StringGetAsync(ConnectionRoomKey(connectionId));
    }

    public async Task SetUserRoomAsync(string userId, string roomId)
    {
        if (string.IsNullOrEmpty(userId)) return;
        await _db.StringSetAsync(UserRoomKey(userId), roomId, TimeSpan.FromHours(24));
    }

    public async Task ClearUserRoomAsync(string userId)
    {
        if (string.IsNullOrEmpty(userId)) return;
        await _db.KeyDeleteAsync(UserRoomKey(userId));
    }

    public async Task<string?> GetSnapshotAsync(string roomId)
    {
        if (string.IsNullOrEmpty(roomId)) return null;
        var val = (string?)await _db.StringGetAsync(SnapshotKey(roomId));
        return val;
    }

    public async Task<IReadOnlyList<RoomEntry>> GetEntriesAsync(string roomId)
    {
        var entries = await _db.HashGetAllAsync(FilesKey(roomId));
        if (entries.Length == 0)
        {
            await _db.HashSetAsync(FilesKey(roomId), "main.cpp", JsonSerializer.Serialize(new RoomEntry("main.cpp", "main.cpp", null, false)), When.NotExists);
            entries = await _db.HashGetAllAsync(FilesKey(roomId));
        }
        return entries.Select(entry => JsonSerializer.Deserialize<RoomEntry>((string)entry.Value!, _jsonOptions))
            .Where(entry => entry is not null).Select(entry => entry!).ToArray();
    }

    public async Task<bool> CreateEntryAsync(string roomId, RoomEntry entry)
    {
        var result = await _db.ScriptEvaluateAsync(CreateRoomEntryScript, [FilesKey(roomId)], [entry.Id, entry.ParentId ?? string.Empty, entry.Name, JsonSerializer.Serialize(entry)]);
        return (int)result == 1;
    }

    public async Task<bool> RenameEntryAsync(string roomId, string id, string name)
    {
        var current = (await GetEntriesAsync(roomId)).FirstOrDefault(entry => entry.Id == id);
        if (current is null) return false;
        var renamed = current with { Name = name };
        var result = await _db.ScriptEvaluateAsync(RenameRoomEntryScript, [FilesKey(roomId)], [id, name, JsonSerializer.Serialize(renamed)]);
        return (int)result == 1;
    }

    public async Task<(int Status, string[] DeletedIds)> DeleteEntryAsync(string roomId, string id)
    {
        var result = await _db.ScriptEvaluateAsync(DeleteRoomEntryScript, [FilesKey(roomId), $"room:{roomId}:file:"], [id]);
        var values = (RedisResult[]?)result ?? [];
        return values.Length == 0
            ? (0, [])
            : ((int)values[0], values.Skip(1).Select(value => (string)value!).ToArray());
    }

    public async Task SaveFileSnapshotAsync(string roomId, string fileId, string snapshot) =>
        await _db.StringSetAsync(FileSnapshotKey(roomId, fileId), snapshot, TimeSpan.FromHours(24));

    public async Task<string?> GetFileSnapshotAsync(string roomId, string fileId) =>
        (string?)await _db.StringGetAsync(FileSnapshotKey(roomId, fileId));

    private static string MetaKey(string roomId) => $"room:{roomId}:meta";
    private static string ParticipantsKey(string roomId) => $"room:{roomId}:participants";
    private static RedisKey ActiveRoomsKey => "syncode:active-rooms";
    private static string InstanceConnectionsKey(string instanceId) => $"syncode:instance:{instanceId}:connections";
    private static string UserRoomKey(string userId) => $"user:{userId}:room";
    private static string ConnectionRoomKey(string connectionId) => $"connection:{connectionId}:room";
    private static string SnapshotKey(string roomId) => $"room:{roomId}:snapshot";
    private static string FilesKey(string roomId) => $"room:{roomId}:files";
    private static string FileSnapshotKey(string roomId, string fileId) => $"room:{roomId}:file:{fileId}:snapshot";
    private static string ChatKey(string roomId) => $"room:{roomId}:chat";
    private static string ChatConnectionRateKey(
        string roomId,
        string connectionId,
        string window) =>
        $"room:{{{roomId}}}:chat:rate:connection:{connectionId}:{window}";
    private static string ChatRoomRateKey(string roomId, string window) =>
        $"room:{{{roomId}}}:chat:rate:{window}";
    private static string FileEntryCreateConnectionRateKey(
        string roomId,
        string connectionId,
        string window) =>
        $"room:{{{roomId}}}:files:create:rate:connection:{connectionId}:{window}";
    private static string FileEntryCreateRoomRateKey(string roomId, string window) =>
        $"room:{{{roomId}}}:files:create:rate:{window}";
}
