using StackExchange.Redis;

namespace server.Services;

internal static class RedisRoomKeys
{
    internal static string Meta(string roomId) => $"room:{roomId}:meta";
    internal static string Participants(string roomId) => $"room:{roomId}:participants";
    internal static string PreviousApprovedParticipants(string roomId) => $"room:{roomId}:approved-participants";
    internal static string PreviousParticipantIdentities(string roomId) => $"room:{roomId}:participant-identities";
    internal static string PendingJoinRequests(string roomId) => $"room:{roomId}:pending-join-requests";
    internal static RedisKey ActiveRooms => "syncode:active-rooms";
    internal static string InstanceConnections(string instanceId) => $"syncode:instance:{instanceId}:connections";
    internal static string ConnectionRoom(string connectionId) => $"connection:{connectionId}:room";
    internal static string Snapshot(string roomId) => $"room:{roomId}:snapshot";
    internal static string Files(string roomId) => $"room:{roomId}:files";
    internal static string FileSnapshot(string roomId, string fileId) => $"room:{roomId}:file:{fileId}:snapshot";
    internal static string ProjectImportBytes(string roomId) => $"room:{roomId}:project-import:bytes";
    internal static string GithubRepository(string roomId) => $"room:{roomId}:github-repository";
    internal static string GithubRepositoryPushLock(string roomId) => $"room:{roomId}:github-repository:push-lock";
    internal static string GithubRepositoryAdminGrant(string tokenHash) => $"github-repository-admin:{tokenHash}";
    internal static string Chat(string roomId) => $"room:{roomId}:chat";
}
