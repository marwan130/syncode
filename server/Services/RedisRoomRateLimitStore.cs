using StackExchange.Redis;

namespace server.Services;

public sealed class RedisRoomRateLimitStore(IConnectionMultiplexer redis)
{
    private const string ConsumeRateLimitScript = """
        local now = tonumber(ARGV[1])
        local member = ARGV[2]
        for i, key in ipairs(KEYS) do
            local limit = tonumber(ARGV[(i - 1) * 2 + 3])
            local window = tonumber(ARGV[(i - 1) * 2 + 4])
            redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
            if redis.call('ZCARD', key) >= limit then return 0 end
        end
        for i, key in ipairs(KEYS) do
            redis.call('ZADD', key, now, member)
            local window = tonumber(ARGV[(i - 1) * 2 + 4])
            redis.call('PEXPIRE', key, window + 1000)
        end
        return 1
        """;

    private readonly IDatabase _db = redis.GetDatabase();

    public Task<bool> TryConsumeProjectImportAsync(string roomId, string connectionId, string importId) =>
        TryConsumeAsync(
            [$"room:{roomId}:project-import:connection:{connectionId}", $"room:{roomId}:project-import:room"],
            importId, 1, 2, 2, 3);

    public Task<bool> TryConsumeChatAsync(string roomId, string connectionId, string messageId) =>
        TryConsumeAsync(
            [ChatConnectionKey(roomId, connectionId, "10s"), ChatConnectionKey(roomId, connectionId, "1m"), ChatRoomKey(roomId, "10s"), ChatRoomKey(roomId, "1m")],
            messageId, 10, 60, 100, 500);

    public Task<bool> TryConsumeFileEntryCreateAsync(string roomId, string connectionId, string operationId) =>
        TryConsumeAsync(
            [FileConnectionKey(roomId, connectionId, "10s"), FileConnectionKey(roomId, connectionId, "1m"), FileRoomKey(roomId, "10s"), FileRoomKey(roomId, "1m")],
            operationId, 20, 120, 200, 500);

    private async Task<bool> TryConsumeAsync(
        RedisKey[] keys,
        string operationId,
        int connectionBurstLimit,
        int connectionMinuteLimit,
        int roomBurstLimit,
        int roomMinuteLimit)
    {
        var result = await _db.ScriptEvaluateAsync(
            ConsumeRateLimitScript,
            keys,
            [DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), operationId, connectionBurstLimit, 10_000,
                connectionMinuteLimit, 60_000, roomBurstLimit, 10_000, roomMinuteLimit, 60_000]);
        return (int)result == 1;
    }

    private static string ChatConnectionKey(string roomId, string connectionId, string window) =>
        $"room:{{{roomId}}}:chat:rate:connection:{connectionId}:{window}";
    private static string ChatRoomKey(string roomId, string window) =>
        $"room:{{{roomId}}}:chat:rate:{window}";
    private static string FileConnectionKey(string roomId, string connectionId, string window) =>
        $"room:{{{roomId}}}:files:create:rate:connection:{connectionId}:{window}";
    private static string FileRoomKey(string roomId, string window) =>
        $"room:{{{roomId}}}:files:create:rate:{window}";
}
