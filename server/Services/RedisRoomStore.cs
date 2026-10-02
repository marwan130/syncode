using System.Text.Json;
using server.Models;
using StackExchange.Redis;

namespace server.Services;

public class RedisRoomStore
{
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

    public async Task CreateRoomAsync(string roomId)
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString();
        var metaKey = MetaKey(roomId);

        await _db.HashSetAsync(metaKey, [
            new HashEntry("createdAt", now),
            new HashEntry("lastActivity", now),
        ]);

        _logger.LogInformation("Created room {RoomId}", roomId);
    }

    public async Task<bool> RoomExistsAsync(string roomId) =>
        await _db.KeyExistsAsync(MetaKey(roomId));

    public async Task TouchRoomAsync(string roomId)
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString();
        await _db.HashSetAsync(MetaKey(roomId), "lastActivity", now);
    }

    public async Task DeleteRoomAsync(string roomId)
    {
        await _db.KeyDeleteAsync([
            MetaKey(roomId),
            ParticipantsKey(roomId),
            SnapshotKey(roomId),
            ChatKey(roomId),
        ]);
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

    public async Task SaveSnapshotAsync(string roomId, string snapshotJson)
    {
        if (string.IsNullOrEmpty(roomId) || string.IsNullOrEmpty(snapshotJson)) return;
        await _db.StringSetAsync(SnapshotKey(roomId), snapshotJson, TimeSpan.FromHours(24));
    }

    public async Task<string?> GetSnapshotAsync(string roomId)
    {
        if (string.IsNullOrEmpty(roomId)) return null;
        var val = (string?)await _db.StringGetAsync(SnapshotKey(roomId));
        return val;
    }

    private static string MetaKey(string roomId) => $"room:{roomId}:meta";
    private static string ParticipantsKey(string roomId) => $"room:{roomId}:participants";
    private static string UserRoomKey(string userId) => $"user:{userId}:room";
    private static string ConnectionRoomKey(string connectionId) => $"connection:{connectionId}:room";
    private static string SnapshotKey(string roomId) => $"room:{roomId}:snapshot";
    private static string ChatKey(string roomId) => $"room:{roomId}:chat";
    private static string ChatConnectionRateKey(
        string roomId,
        string connectionId,
        string window) =>
        $"room:{{{roomId}}}:chat:rate:connection:{connectionId}:{window}";
    private static string ChatRoomRateKey(string roomId, string window) =>
        $"room:{{{roomId}}}:chat:rate:{window}";
}
