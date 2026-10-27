using System.Security.Cryptography;
using System.Text;
using System.Collections.Concurrent;

namespace Syncode.ExecutionService.Runner;

public sealed class RoomDependencyStore(IConfiguration configuration)
{
    public const long MaximumRoomBytes = 256L * 1024 * 1024;
    private static readonly TimeSpan QuotaCheckInterval = TimeSpan.FromSeconds(5);
    private readonly ConcurrentDictionary<string, (DateTimeOffset CheckedAt, bool Exceeded)> _quotaState = new(StringComparer.Ordinal);
    private readonly string _root = Path.GetFullPath(
        configuration["ExecutionService:DependencyRoot"] ??
        Path.Combine(Path.GetTempPath(), "syncode-dependencies"));

    public string GetRoomPath(string roomId)
    {
        if (string.IsNullOrWhiteSpace(roomId) || roomId.Length > 128)
            throw new ArgumentException("Invalid room id.", nameof(roomId));
        var roomKey = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(roomId))).ToLowerInvariant();
        var path = Path.GetFullPath(Path.Combine(_root, roomKey));
        if (!path.StartsWith(_root + Path.DirectorySeparatorChar, StringComparison.Ordinal))
            throw new InvalidOperationException("Room dependency path is outside its root.");
        Directory.CreateDirectory(path);
        Directory.CreateDirectory(Path.Combine(path, "npm-project", "node_modules"));
        return path;
    }

    public bool ExceedsRoomLimit(string roomId)
    {
        var now = DateTimeOffset.UtcNow;
        if (_quotaState.TryGetValue(roomId, out var previous) && now - previous.CheckedAt < QuotaCheckInterval)
            return previous.Exceeded;

        var root = GetRoomPath(roomId);
        long bytes = 0;
        var pending = new Stack<string>();
        pending.Push(root);
        while (pending.TryPop(out var directory))
        {
            foreach (var path in Directory.EnumerateFileSystemEntries(directory))
            {
                var attributes = File.GetAttributes(path);
                if ((attributes & FileAttributes.ReparsePoint) != 0) continue;
                if ((attributes & FileAttributes.Directory) != 0)
                {
                    pending.Push(path);
                    continue;
                }
                bytes += new FileInfo(path).Length;
                if (bytes > MaximumRoomBytes)
                {
                    _quotaState[roomId] = (now, true);
                    return true;
                }
            }
        }
        _quotaState[roomId] = (now, false);
        return false;
    }

    public void DeleteRoom(string roomId)
    {
        var path = GetRoomPath(roomId);
        Directory.Delete(path, recursive: true);
        _quotaState.TryRemove(roomId, out _);
    }
}
