using System.Text.Json;
using StackExchange.Redis;
using Syncode.ExecutionService.Runner;

namespace Syncode.ExecutionService.Queue;

public sealed class ExecutionOutputPublisher(
    ISubscriber subscriber,
    RedisChannel channel,
    ILogger<ExecutionOutputPublisher> logger)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public Task PublishOutputAsync(ExecutionJob job, ExecutionOutputChunk chunk) => PublishAsync(new(
        job.RoomId,
        job.Id,
        job.RequestId,
        "output",
        chunk.Stream == ExecutionOutputStream.StandardError ? "stderr" : "stdout",
        chunk.Text));

    public Task PublishCompletedAsync(ExecutionJob job, ExecutionResult result) => PublishAsync(new(
        job.RoomId,
        job.Id,
        job.RequestId,
        "completed",
        ExitCode: result.ExitCode,
        TimedOut: result.TimedOut,
        OutputLimitExceeded: result.OutputLimitExceeded));

    public Task PublishFailedAsync(ExecutionJob job) =>
        PublishAsync(new(job.RoomId, job.Id, job.RequestId, "failed"));

    private async Task PublishAsync(ExecutionOutputEvent executionEvent)
    {
        try
        {
            var json = JsonSerializer.Serialize(executionEvent, JsonOptions);
            await subscriber.PublishAsync(channel, json);
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception, "Could not publish output for execution {ExecutionId}", executionEvent.JobId);
        }
    }
}

public sealed record ExecutionOutputEvent(
    string RoomId,
    string JobId,
    string RequestId,
    string Type,
    string? Stream = null,
    string? Text = null,
    int? ExitCode = null,
    bool? TimedOut = null,
    bool? OutputLimitExceeded = null);
