using StackExchange.Redis;
using Syncode.ExecutionService.Queue;
using Syncode.ExecutionService.Runner;
using Xunit;

namespace Syncode.ExecutionService.Tests;

public sealed class ExecutionJobQueueTests
{
    [RedisQueueIntegrationFact]
    [Trait("Category", "RedisIntegration")]
    public async Task Queue_DeduplicatesRepeatedRequestIdsWithinRoom()
    {
        var connectionString = Environment.GetEnvironmentVariable("SYNCODE_REDIS_CONNECTION")!;
        using var redis = await ConnectionMultiplexer.ConnectAsync(connectionString);
        var database = redis.GetDatabase();
        var prefix = $"syncode:test:{Guid.NewGuid():N}";
        var queue = new ExecutionJobQueue(redis, maxPendingJobs: 2, keyPrefix: prefix);
        var first = CreateJob();
        var retry = first with { Id = Guid.NewGuid().ToString("N"), Source = "console.log('duplicate')" };

        try
        {
            var original = await queue.EnqueueOrGetAsync(first);
            var repeated = await queue.EnqueueOrGetAsync(retry);

            Assert.False(original.IsDuplicate);
            Assert.True(repeated.IsDuplicate);
            Assert.Equal(first.Id, repeated.JobId);
            Assert.Equal(first, await queue.DequeueAsync(CancellationToken.None));
            Assert.Null(await queue.DequeueAsync(CancellationToken.None));
        }
        finally
        {
            await database.KeyDeleteAsync($"{prefix}:queue");
            foreach (var id in new[] { first.Id, retry.Id })
            {
                await database.KeyDeleteAsync($"{prefix}:status:{id}");
                await database.KeyDeleteAsync($"{prefix}:job:{id}");
                await database.KeyDeleteAsync($"{prefix}:output:{id}");
            }
        }
    }

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
            var firstResult = await queue.EnqueueOrGetAsync(first);
            var secondResult = await queue.EnqueueOrGetAsync(second);
            var rejectedResult = await queue.EnqueueOrGetAsync(rejected);
            Assert.Equal(1, firstResult.QueuePosition);
            Assert.Equal(2, secondResult.QueuePosition);
            Assert.True(rejectedResult.IsFull);

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
        DateTimeOffset.UtcNow,
        Guid.NewGuid().ToString("D"));
}

public sealed class RedisQueueIntegrationFactAttribute : FactAttribute
{
    public RedisQueueIntegrationFactAttribute()
    {
        if (string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("SYNCODE_REDIS_CONNECTION")))
            Skip = "Set SYNCODE_REDIS_CONNECTION to run Redis queue integration checks.";
    }
}
