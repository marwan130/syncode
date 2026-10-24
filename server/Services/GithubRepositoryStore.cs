using System.Text.Json;
using server.Models;
using StackExchange.Redis;

namespace server.Services;

public sealed class GithubRepositoryStore(IConnectionMultiplexer redis)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly IDatabase _database = redis.GetDatabase();
    private const string PushLockScript = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

    public async Task<GithubRepositoryBaseline?> GetAsync(string roomId)
    {
        var value = await _database.StringGetAsync(RedisRoomKeys.GithubRepository(roomId));
        return value.IsNullOrEmpty
            ? null
            : JsonSerializer.Deserialize<GithubRepositoryBaseline>(value.ToString(), JsonOptions);
    }

    public Task SetAsync(string roomId, GithubRepositoryBaseline? baseline) =>
        baseline is null
            ? _database.KeyDeleteAsync(RedisRoomKeys.GithubRepository(roomId))
            : _database.StringSetAsync(
                RedisRoomKeys.GithubRepository(roomId),
                JsonSerializer.Serialize(baseline, JsonOptions));

    public Task<bool> TryAcquirePushLockAsync(string roomId, string value) =>
        _database.StringSetAsync(
            RedisRoomKeys.GithubRepositoryPushLock(roomId),
            value,
            TimeSpan.FromMinutes(2),
            When.NotExists);

    public Task ReleasePushLockAsync(string roomId, string value) =>
        _database.ScriptEvaluateAsync(
            PushLockScript,
            [RedisRoomKeys.GithubRepositoryPushLock(roomId)],
            [value]);
}
