using System.Text.Json;
using server.Application.Projects;
using StackExchange.Redis;

namespace server.Services;

public class RedisFileStore : IProjectEntryStore, IProjectSnapshotWriter, IProjectSnapshotReader
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    private readonly IDatabase _db;
    public RedisFileStore(IConnectionMultiplexer redis)
    {
        _db = redis.GetDatabase();
    }
    public async Task<string?> GetSnapshotAsync(string roomId)
    {
        if (string.IsNullOrEmpty(roomId)) return null;
        var val = (string?)await _db.StringGetAsync(RedisRoomKeys.Snapshot(roomId));
        return val;
    }

    public Task<string?> GetLegacyRoomSnapshotAsync(string roomId) => GetSnapshotAsync(roomId);

    public async Task<IReadOnlyList<ProjectEntry>> GetEntriesAsync(string roomId)
    {
        var entries = await _db.HashGetAllAsync(RedisRoomKeys.Files(roomId));
        return entries.Select(entry => JsonSerializer.Deserialize<ProjectEntry>((string)entry.Value!, JsonOptions))
            .Where(entry => entry is not null).Select(entry => entry!).ToArray();
    }

    public async Task SaveFileSnapshotAsync(string roomId, string fileId, string snapshot) =>
        await _db.StringSetAsync(RedisRoomKeys.FileSnapshot(roomId, fileId), snapshot, TimeSpan.FromHours(24));

    public async Task DeleteFileSnapshotsAsync(string roomId, IReadOnlyCollection<string> fileIds)
    {
        if (fileIds.Count == 0) return;
        var keys = fileIds.Select(fileId => (RedisKey)RedisRoomKeys.FileSnapshot(roomId, fileId)).ToArray();
        await _db.KeyDeleteAsync(keys);
    }

    public async Task<string?> GetFileSnapshotAsync(string roomId, string fileId) =>
        (string?)await _db.StringGetAsync(RedisRoomKeys.FileSnapshot(roomId, fileId));
}
