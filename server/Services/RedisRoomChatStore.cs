using System.Text.Json;
using server.Models;
using StackExchange.Redis;

namespace server.Services;

public sealed class RedisRoomChatStore(IConnectionMultiplexer redis)
{
    private const int HistoryLimit = 100;
    private const string AppendMessageScript = """
        redis.call('RPUSH', KEYS[1], ARGV[1])
        redis.call('LTRIM', KEYS[1], -100, -1)
        return 1
        """;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = true
    };
    private readonly IDatabase _db = redis.GetDatabase();

    public async Task AppendMessageAsync(string roomId, ChatMessage message) =>
        await _db.ScriptEvaluateAsync(
            AppendMessageScript,
            [RedisRoomKeys.Chat(roomId)],
            [JsonSerializer.Serialize(message)]);

    public async Task<IReadOnlyList<ChatMessage>> GetMessagesAsync(string roomId)
    {
        var entries = await _db.ListRangeAsync(RedisRoomKeys.Chat(roomId), -HistoryLimit, -1);
        return entries
            .Select(entry => JsonSerializer.Deserialize<ChatMessage>((string)entry!, JsonOptions))
            .Where(message => message is not null)
            .Select(message => message!)
            .ToArray();
    }
}
