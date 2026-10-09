using System.Security.Cryptography;
using System.Text;
using StackExchange.Redis;

namespace Syncode.ExecutionService.Security;

public sealed class ExecutionRateLimiter
{
    private const string ConsumeScript = """
        local clock = redis.call('TIME')
        local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
        local window = tonumber(ARGV[2])
        redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
        local count = redis.call('ZCARD', KEYS[1])
        local limit = tonumber(ARGV[1])
        if count >= limit then
            local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
            local retryAfter = tonumber(oldest[2]) + window - now
            return {0, math.max(1, retryAfter)}
        end
        redis.call('ZADD', KEYS[1], now, ARGV[3])
        redis.call('PEXPIRE', KEYS[1], window)
        return {1, 0}
        """;

    private readonly IDatabase _database;
    private readonly string _keyPrefix;
    private readonly int _limit;
    private readonly TimeSpan _window;

    public ExecutionRateLimiter(
        IConnectionMultiplexer redis,
        string keyPrefix = "syncode:execution",
        int limit = 10,
        TimeSpan? window = null)
    {
        ArgumentNullException.ThrowIfNull(redis);
        if (string.IsNullOrWhiteSpace(keyPrefix))
            throw new ArgumentException("A Redis key prefix is required.", nameof(keyPrefix));
        if (limit < 1)
            throw new ArgumentOutOfRangeException(nameof(limit));

        _database = redis.GetDatabase();
        _keyPrefix = keyPrefix;
        _limit = limit;
        _window = window ?? TimeSpan.FromMinutes(1);
        if (_window <= TimeSpan.Zero)
            throw new ArgumentOutOfRangeException(nameof(window));
    }

    public async Task<ExecutionRateLimitResult> TryAcquireAsync(
        string roomId,
        string requestId,
        CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        ArgumentException.ThrowIfNullOrWhiteSpace(roomId);
        ArgumentException.ThrowIfNullOrWhiteSpace(requestId);

        var windowMilliseconds = checked((long)_window.TotalMilliseconds);
        var key = $"{_keyPrefix}:rate:room:{HashRoomId(roomId)}";
        var result = (RedisResult[]?)await _database.ScriptEvaluateAsync(
            ConsumeScript,
            [key],
            [_limit, windowMilliseconds, requestId]);

        if (result is not { Length: 2 })
            throw new InvalidOperationException("Redis returned an invalid execution rate-limit result.");

        var allowed = (long)result[0]! == 1;
        var retryAfterMilliseconds = (long)result[1]!;
        return new ExecutionRateLimitResult(
            allowed,
            allowed ? TimeSpan.Zero : TimeSpan.FromMilliseconds(retryAfterMilliseconds));
    }

    private static string HashRoomId(string roomId) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(roomId))).ToLowerInvariant();
}

public sealed record ExecutionRateLimitResult(bool Allowed, TimeSpan RetryAfter);
