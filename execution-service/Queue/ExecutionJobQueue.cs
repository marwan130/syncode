using System.Text.Json;
using StackExchange.Redis;
using Syncode.ExecutionService.Runner;

namespace Syncode.ExecutionService.Queue;

public sealed class ExecutionJobQueue
{
    private const string EnqueueScript = """
        local existing = redis.call('GET', KEYS[4])
        if existing then return {0, existing, 0} end
        local length = redis.call('LLEN', KEYS[1])
        if length >= tonumber(ARGV[1]) then return {-1, '', 0} end
        redis.call('RPUSH', KEYS[1], ARGV[2])
        redis.call('SET', KEYS[3], ARGV[3], 'EX', ARGV[4])
        redis.call('HSET', KEYS[2], 'state', 'pending', 'queuePosition', length + 1)
        redis.call('EXPIRE', KEYS[2], ARGV[4])
        redis.call('SET', KEYS[4], ARGV[2], 'EX', ARGV[4])
        return {1, ARGV[2], length + 1}
        """;

    private static readonly TimeSpan StatusLifetime = TimeSpan.FromDays(1);
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly IDatabase _database;
    private readonly int _maxPendingJobs;
    private readonly RedisKey _queueKey;
    private readonly string _statusPrefix;
    private readonly string _outputPrefix;
    private readonly string _payloadPrefix;

    public ExecutionJobQueue(IConnectionMultiplexer redis, int maxPendingJobs = 50, string keyPrefix = "syncode:execution")
    {
        if (maxPendingJobs < 1)
            throw new ArgumentOutOfRangeException(nameof(maxPendingJobs));
        if (string.IsNullOrWhiteSpace(keyPrefix))
            throw new ArgumentException("A Redis key prefix is required.", nameof(keyPrefix));

        _database = redis.GetDatabase();
        _maxPendingJobs = maxPendingJobs;
        _queueKey = $"{keyPrefix}:queue";
        _statusPrefix = $"{keyPrefix}:status:";
        _outputPrefix = $"{keyPrefix}:output:";
        _payloadPrefix = $"{keyPrefix}:job:";
    }

    public async Task<ExecutionEnqueueResult> EnqueueOrGetAsync(ExecutionJob job, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var payload = JsonSerializer.Serialize(job, JsonOptions);
        var statusKey = StatusKey(job.Id);
        var payloadKey = PayloadKey(job.Id);
        var idempotencyKey = IdempotencyKey(job.RoomId, job.RequestId);
        var result = (RedisResult[]?)await _database.ScriptEvaluateAsync(
            EnqueueScript,
            [_queueKey, statusKey, payloadKey, idempotencyKey],
            [_maxPendingJobs, job.Id, payload, (long)StatusLifetime.TotalSeconds]);

        if (result is not { Length: 3 })
            throw new InvalidOperationException("Redis returned an invalid execution enqueue result.");
        var state = (long)result[0]!;
        if (state < 0) return new ExecutionEnqueueResult(null, 0, IsFull: true, IsDuplicate: false);
        var jobId = (string?)result[1];
        if (string.IsNullOrEmpty(jobId)) throw new InvalidOperationException("Redis returned an invalid execution id.");
        if (state == 0)
        {
            var status = await GetStatusAsync(jobId, cancellationToken);
            var position = status is not null && int.TryParse(status.GetValueOrDefault("queuePosition"), out var pendingPosition)
                ? pendingPosition
                : 1;
            return new ExecutionEnqueueResult(jobId, position, IsFull: false, IsDuplicate: true);
        }
        return new ExecutionEnqueueResult(jobId, checked((int)(long)result[2]!), IsFull: false, IsDuplicate: false);
    }

    public async Task<ExecutionJob?> DequeueAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var id = await _database.ListLeftPopAsync(_queueKey);
        if (id.IsNullOrEmpty)
            return null;

        var payloadKey = PayloadKey((string)id!);
        var payload = await _database.StringGetDeleteAsync(payloadKey);
        if (payload.IsNullOrEmpty)
            return null;
        return JsonSerializer.Deserialize<ExecutionJob>((string)payload!, JsonOptions);
    }

    public async Task MarkRunningAsync(ExecutionJob job)
    {
        var key = StatusKey(job.Id);
        await _database.HashSetAsync(key,
        [
            new HashEntry("state", "running"),
            new HashEntry("startedAt", DateTimeOffset.UtcNow.ToString("O"))
        ]);
        await _database.HashDeleteAsync(key, "queuePosition");
        await _database.KeyExpireAsync(key, StatusLifetime);
    }

    public Task MarkCompletedAsync(ExecutionJob job, ExecutionResult result) =>
        UpdateStatusAsync(job.Id,
        [
            new HashEntry("state", "completed"),
            new HashEntry("exitCode", result.ExitCode),
            new HashEntry("timedOut", result.TimedOut),
            new HashEntry("outputLimitExceeded", result.OutputLimitExceeded),
            new HashEntry("durationMilliseconds", (long)result.Duration.TotalMilliseconds),
            new HashEntry("completedAt", DateTimeOffset.UtcNow.ToString("O"))
        ]);

    public Task MarkFailedAsync(ExecutionJob job) =>
        UpdateStatusAsync(job.Id, [new HashEntry("state", "failed"), new HashEntry("completedAt", DateTimeOffset.UtcNow.ToString("O"))]);

    public Task MarkCancelledAsync(ExecutionJob job) =>
        UpdateStatusAsync(job.Id, [new HashEntry("state", "cancelled"), new HashEntry("completedAt", DateTimeOffset.UtcNow.ToString("O"))]);

    public async Task AppendOutputAsync(string jobId, ExecutionOutputChunk chunk)
    {
        var key = OutputKey(jobId);
        await _database.StringAppendAsync(key, chunk.Text);
        await _database.KeyExpireAsync(key, StatusLifetime);
    }

    public async Task<Dictionary<string, string>?> GetStatusAsync(string jobId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var entries = await _database.HashGetAllAsync(StatusKey(jobId));
        cancellationToken.ThrowIfCancellationRequested();
        if (entries.Length == 0)
            return null;

        var status = entries.ToDictionary(entry => (string)entry.Name!, entry => (string)entry.Value!, StringComparer.Ordinal);
        if (status.TryGetValue("state", out var state) && state == "pending")
        {
            var pendingIds = await _database.ListRangeAsync(_queueKey, 0, _maxPendingJobs - 1L);
            var position = Array.FindIndex(pendingIds, id => id == jobId);
            if (position >= 0)
                status["queuePosition"] = (position + 1).ToString(System.Globalization.CultureInfo.InvariantCulture);
            else
                status.Remove("queuePosition");
        }

        var output = await _database.StringGetAsync(OutputKey(jobId));
        cancellationToken.ThrowIfCancellationRequested();
        status["output"] = output.IsNull ? string.Empty : (string)output!;
        return status;
    }

    private Task UpdateStatusAsync(string jobId, HashEntry[] fields) =>
        _database.HashSetAsync(StatusKey(jobId), fields);

    private RedisKey StatusKey(string jobId) => $"{_statusPrefix}{jobId}";
    private RedisKey OutputKey(string jobId) => $"{_outputPrefix}{jobId}";
    private RedisKey PayloadKey(string jobId) => $"{_payloadPrefix}{jobId}";
    private RedisKey IdempotencyKey(string roomId, string requestId)
    {
        var bytes = System.Text.Encoding.UTF8.GetBytes($"{roomId}\n{requestId}");
        return $"{_statusPrefix}request:{Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(bytes)).ToLowerInvariant()}";
    }
}

public sealed record ExecutionEnqueueResult(string? JobId, int QueuePosition, bool IsFull, bool IsDuplicate);
