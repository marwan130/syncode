using StackExchange.Redis;
using Syncode.ExecutionService.Queue;
using Syncode.ExecutionService.Runner;
using Xunit;

namespace Syncode.ExecutionService.Tests;

public sealed class ExecutionJobQueueTests
{
    [RedisQueueIntegrationFact]
    [Trait("Category", "RedisIntegration")]
    public async Task Queue_EnforcesCapacityAndReportsLivePendingPosition()
    {
        var connectionString = Environment.GetEnvironmentVariable("SYNCODE_REDIS_CONNECTION")!;
        using var redis = await ConnectionMultiplexer.ConnectAsync(connectionString);
        var database = redis.GetDatabase();
        var prefix = $"syncode:test:{Guid.NewGuid():N}";
        var queue = new ExecutionJobQueue(redis, maxPendingJobs: 2, keyPrefix: prefix);
        var first = CreateJob();
        var second = CreateJob();
        var rejected = CreateJob();

        try
        {
            Assert.Equal(1, await queue.EnqueueAsync(first));
            Assert.Equal(2, await queue.EnqueueAsync(second));
            Assert.Null(await queue.EnqueueAsync(rejected));

            var secondStatus = await queue.GetStatusAsync(second.Id, CancellationToken.None);
            Assert.Equal("2", secondStatus!["queuePosition"]);

            var dequeued = await queue.DequeueAsync(CancellationToken.None);
            Assert.Equal(first, dequeued);
            await queue.MarkRunningAsync(dequeued!);

            secondStatus = await queue.GetStatusAsync(second.Id, CancellationToken.None);
            Assert.Equal("pending", secondStatus!["state"]);
            Assert.Equal("1", secondStatus["queuePosition"]);

            var next = await queue.DequeueAsync(CancellationToken.None);
            Assert.Equal(second, next);
        }
        finally
        {
            await database.KeyDeleteAsync($"{prefix}:queue");
            foreach (var job in new[] { first, second, rejected })
            {
                await database.KeyDeleteAsync($"{prefix}:status:{job.Id}");
                await database.KeyDeleteAsync($"{prefix}:job:{job.Id}");
                await database.KeyDeleteAsync($"{prefix}:output:{job.Id}");
            }
        }
    }

    private static ExecutionJob CreateJob() => new(
        Guid.NewGuid().ToString("N"),
        "queue-test-room",
        "queue-test-user",
        ExecutionLanguage.JavaScript,
        "console.log('queued')",
        DateTimeOffset.UtcNow);
}

public sealed class RedisQueueIntegrationFactAttribute : FactAttribute
{
    public RedisQueueIntegrationFactAttribute()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("SYNCODE_REDIS_CONNECTION")))
            Skip = "Set SYNCODE_REDIS_CONNECTION to run Redis queue integration checks.";
    }
}
