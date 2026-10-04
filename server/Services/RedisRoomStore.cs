using System.Text.Json;
using System.Security.Cryptography;
using server.Models;
using StackExchange.Redis;

namespace server.Services;

public class RedisRoomStore
{
    public sealed record RoomEntry(string Id, string Name, string? ParentId, bool IsFolder);
    private const int ChatHistoryLimit = 100;
    private const string ConsumeChatRateLimitScript = """
        local now = tonumber(ARGV[1])
        local member = ARGV[2]
        local limits = {5, 10000, 30, 60000, 100, 10000, 500, 60000}
        for i, key in ipairs(KEYS) do
            local limit = limits[(i - 1) * 2 + 1]
            local window = limits[(i - 1) * 2 + 2]
            redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
            if redis.call('ZCARD', key) >= limit then
                return 0
            end
        end
        for i, key in ipairs(KEYS) do
            redis.call('ZADD', key, now, member)
            redis.call('PEXPIRE', key, limits[(i - 1) * 2 + 2] + 1000)
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

    private static readonly JsonSerializerOptions _jsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    private readonly IDatabase _db;
    private readonly ILogger<RedisRoomStore> _logger;

    public RedisRoomStore(IConnectionMultiplexer redis, ILogger<RedisRoomStore> logger)
    {
        _db = redis.GetDatabase();
        _logger = logger;
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

        _logger.LogInformation("Created room {RoomId}", roomId);
    }

    public async Task<bool> ValidateRoomAccessAsync(string roomId, string accessKey)
    {
        if (string.IsNullOrEmpty(roomId) ||
            roomId.Length != 8 ||
            !roomId.All(character =>
                character is >= 'a' and <= 'z' or >= '0' and <= '9') ||
            string.IsNullOrEmpty(accessKey) ||
            accessKey.Length != 64 ||
            !accessKey.All(Uri.IsHexDigit))
        {
            return false;
        }

        var storedHash = (string?)await _db.HashGetAsync(MetaKey(roomId), "accessKeyHash");
        if (storedHash is null) return false;

        var suppliedHash = SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(accessKey));
        var expectedHash = Convert.FromHexString(storedHash);
        return CryptographicOperations.FixedTimeEquals(suppliedHash, expectedHash);
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
        _logger.LogInformation("Deleted room {RoomId}", roomId);
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
        var result = await _db.ScriptEvaluateAsync(
            ConsumeChatRateLimitScript,
            [
                ChatConnectionRateKey(roomId, connectionId, "10s"),
                ChatConnectionRateKey(roomId, connectionId, "1m"),
                ChatRoomRateKey(roomId, "10s"),
                ChatRoomRateKey(roomId, "1m"),
            ],
            [DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), messageId]);
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

    public async Task AddParticipantAsync(string roomId, Participant participant)
    {
        var json = JsonSerializer.Serialize(participant);
        await _db.HashSetAsync(ParticipantsKey(roomId), participant.ConnectionId, json);
    }

    public async Task RemoveParticipantAsync(string roomId, string connectionId) =>
        await _db.HashDeleteAsync(ParticipantsKey(roomId), connectionId);

    public async Task<bool> IsParticipantAsync(string roomId, string connectionId) =>
        await _db.HashExistsAsync(ParticipantsKey(roomId), connectionId);

    public async Task<IReadOnlyList<Participant>> GetParticipantsAsync(string roomId)
    {
        var entries = await _db.HashGetAllAsync(ParticipantsKey(roomId));
        var participants = new List<Participant>();

        foreach (var entry in entries)
        {
            var p = JsonSerializer.Deserialize<Participant>((string)entry.Value!, _jsonOptions);
            if (p is not null) participants.Add(p);
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

    public async Task SetConnectionRoomAsync(string connectionId, string roomId) =>
        await _db.StringSetAsync(ConnectionRoomKey(connectionId), roomId, TimeSpan.FromHours(24));

    public async Task ClearConnectionRoomAsync(string connectionId)
    {
        if (!string.IsNullOrEmpty(connectionId))
            await _db.KeyDeleteAsync(ConnectionRoomKey(connectionId));
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

    public async Task RemoveUserFromRoomAsync(string roomId, string userId)
    {
        if (string.IsNullOrEmpty(roomId) || string.IsNullOrEmpty(userId)) return;
        var entries = await _db.HashGetAllAsync(ParticipantsKey(roomId));
        foreach (var entry in entries)
        {
            var p = JsonSerializer.Deserialize<Participant>((string)entry.Value!, _jsonOptions);
            if (p is not null && p.UserId == userId)
            {
                await _db.HashDeleteAsync(ParticipantsKey(roomId), entry.Name);
            }
        }
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
}
