using System.Security.Cryptography;
using System.Text;
using StackExchange.Redis;
using Syncode.ExecutionService.Security;
using Xunit;

namespace Syncode.ExecutionService.Tests;

public sealed class ExecutionRateLimiterTests
{
    [RedisQueueIntegrationFact]
    [Trait("Category", "RedisIntegration")]
    public async Task RateLimiter_RejectsExcessRequestsPerRoomAndReturnsRetryDelay()
    {
        var connectionString = Environment.GetEnvironmentVariable("SYNCODE_REDIS_CONNECTION")!;
        using var redis = await ConnectionMultiplexer.ConnectAsync(connectionString);
        var prefix = $"syncode:test:{Guid.NewGuid():N}";
        const string roomId = "rate-limit-test-room";
        var key = $"{prefix}:rate:room:{Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(roomId))).ToLowerInvariant()}";
        var limiter = new ExecutionRateLimiter(redis, prefix, limit: 2, TimeSpan.FromMinutes(1));

        try
        {
            Assert.True((await limiter.TryAcquireAsync(roomId, Guid.NewGuid().ToString("N"))).Allowed);
            Assert.True((await limiter.TryAcquireAsync(roomId, Guid.NewGuid().ToString("N"))).Allowed);

            var rejected = await limiter.TryAcquireAsync(roomId, Guid.NewGuid().ToString("N"));
            Assert.False(rejected.Allowed);
            Assert.True(rejected.RetryAfter > TimeSpan.Zero);

            Assert.True((await limiter.TryAcquireAsync("another-room", Guid.NewGuid().ToString("N"))).Allowed);
        }
        finally
        {
            await redis.GetDatabase().KeyDeleteAsync(key);
        }
    }
}
