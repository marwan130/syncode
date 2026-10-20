using StackExchange.Redis;

namespace server.Services;

internal static class RedisRoomKeys
{
    internal static string Meta(string roomId) => $"room:{roomId}:meta";
    internal static string Participants(string roomId) => $"room:{roomId}:participants";
    internal static RedisKey ActiveRooms => "syncode:active-rooms";
    internal static string InstanceConnections(string instanceId) => $"syncode:instance:{instanceId}:connections";
    internal static string ConnectionRoom(string connectionId) => $"connection:{connectionId}:room";
    internal static string Snapshot(string roomId) => $"room:{roomId}:snapshot";
    internal static string Files(string roomId) => $"room:{roomId}:files";
    internal static string FileSnapshot(string roomId, string fileId) => $"room:{roomId}:file:{fileId}:snapshot";
    internal static string ProjectImportBytes(string roomId) => $"room:{roomId}:project-import:bytes";
    internal static string Chat(string roomId) => $"room:{roomId}:chat";
}
