using System.Text.Json;
using server.Models;
using StackExchange.Redis;

namespace server.Services;

public class RedisRoomStore
{
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
        await _db.KeyDeleteAsync([MetaKey(roomId), ParticipantsKey(roomId)]);
        _logger.LogInformation("Deleted room {RoomId}", roomId);
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

    public async Task<IReadOnlyList<Participant>> GetParticipantsAsync(string roomId)
    {
        var entries = await _db.HashGetAllAsync(ParticipantsKey(roomId));
        var participants = new List<Participant>();

        foreach (var entry in entries)
        {
            var p = JsonSerializer.Deserialize<Participant>((string)entry.Value!);
            if (p is not null) participants.Add(p);
        }

        return participants;
    }

    private static string MetaKey(string roomId) => $"room:{roomId}:meta";
    private static string ParticipantsKey(string roomId) => $"room:{roomId}:participants";
}
