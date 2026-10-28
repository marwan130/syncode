using System.Text.Json;
using server.Application.Rooms;
using StackExchange.Redis;

namespace server.Services;

public sealed class RedisParticipantStore : IRoomParticipantStore
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };
    private readonly IDatabase _db;

    public RedisParticipantStore(IConnectionMultiplexer redis) => _db = redis.GetDatabase();
    public async Task<int> TryAdmitParticipantAsync(
        string roomId,
        Participant participant,
        string instanceId,
        int maxParticipants,
        int maxActiveRooms,
        int maxConnections,
        bool isRoomCreator,
        bool isReturningMember,
        bool returningMemberIsAdmin,
        bool returningMemberIsLocked,
        bool hasReturningAdmin)
    {
        return (int)await _db.ScriptEvaluateAsync(
            RedisParticipantScripts.AdmitParticipantScript,
            [RedisRoomKeys.Participants(roomId), RedisRoomKeys.Meta(roomId), RedisRoomKeys.ActiveRooms, RedisRoomKeys.InstanceConnections(instanceId), RedisRoomKeys.ConnectionRoom(participant.ConnectionId)],
            [participant.ConnectionId, JsonSerializer.Serialize(participant), instanceId, maxParticipants, roomId, maxActiveRooms, maxConnections, isRoomCreator ? "1" : "0", isReturningMember ? "1" : "0", returningMemberIsAdmin ? "1" : "0", returningMemberIsLocked ? "1" : "0", hasReturningAdmin ? "1" : "0"]);
    }

    public async Task<bool> TryRegisterConnectionAsync(string connectionId, string instanceId, int maxConnections) =>
        (int)await _db.ScriptEvaluateAsync(
            RedisParticipantScripts.RegisterConnectionScript,
            [RedisRoomKeys.InstanceConnections(instanceId)],
            [connectionId, maxConnections]) == 1;

    public async Task UnregisterConnectionAsync(string connectionId, string instanceId) =>
        await _db.SetRemoveAsync(RedisRoomKeys.InstanceConnections(instanceId), connectionId);

    public async Task RefreshInstanceConnectionLeaseAsync(string instanceId) =>
        await _db.KeyExpireAsync(RedisRoomKeys.InstanceConnections(instanceId), TimeSpan.FromMinutes(2));

    public async Task RemoveParticipantAsync(string roomId, string connectionId, string instanceId) =>
        await _db.ScriptEvaluateAsync(
            RedisParticipantScripts.RemoveParticipantScript,
            [RedisRoomKeys.Participants(roomId), RedisRoomKeys.ActiveRooms, RedisRoomKeys.ConnectionRoom(connectionId), RedisRoomKeys.InstanceConnections(instanceId)],
            [connectionId, roomId]);

    public async Task<ParticipantActionResult> ToggleParticipantLockedAsync(
        string roomId,
        string actorConnectionId,
        string targetConnectionId)
    {
        var result = await _db.ScriptEvaluateAsync(
            RedisParticipantScripts.ToggleParticipantLockScript,
            [RedisRoomKeys.Participants(roomId)],
            [actorConnectionId, targetConnectionId]);
        var value = (string?)result;
        if (int.TryParse(value, out var status)) return new ParticipantActionResult(status, null);
        var participant = JsonSerializer.Deserialize<Participant>(value!, JsonOptions);
        return new ParticipantActionResult(participant is null ? 0 : 1, participant);
    }

    public async Task<ParticipantActionResult> KickParticipantAsync(
        string roomId,
        string actorConnectionId,
        string targetConnectionId)
    {
        var result = await _db.ScriptEvaluateAsync(
            RedisParticipantScripts.KickParticipantScript,
            [RedisRoomKeys.Participants(roomId), RedisRoomKeys.ActiveRooms, RedisRoomKeys.ConnectionRoom(targetConnectionId)],
            [actorConnectionId, targetConnectionId, roomId]);
        var value = (string?)result;
        if (int.TryParse(value, out var status)) return new ParticipantActionResult(status, null);
        var participant = JsonSerializer.Deserialize<Participant>(value!, JsonOptions);
        return new ParticipantActionResult(participant is null ? 0 : 1, participant);
    }

    public async Task<Participant?> UpdateParticipantColorAsync(
        string roomId,
        string connectionId,
        string color)
    {
        var result = await _db.ScriptEvaluateAsync(
            RedisParticipantScripts.UpdateParticipantColorScript,
            [RedisRoomKeys.Participants(roomId)],
            [connectionId, color]);
        var value = (string?)result;
        return string.IsNullOrEmpty(value) || value == "0"
            ? null
            : JsonSerializer.Deserialize<Participant>(value, JsonOptions);
    }

    public async Task<Participant?> UpdateParticipantAvatarAsync(
        string roomId,
        string connectionId,
        string? avatarUrl)
    {
        var result = await _db.ScriptEvaluateAsync(
            RedisParticipantScripts.UpdateParticipantAvatarScript,
            [RedisRoomKeys.Participants(roomId)],
            [connectionId, avatarUrl ?? ""]);
        var value = (string?)result;
        return string.IsNullOrEmpty(value) || value == "0"
            ? null
            : JsonSerializer.Deserialize<Participant>(value, JsonOptions);
    }

    public async Task<ParticipantActionResult> SetParticipantAdminAsync(
        string roomId,
        string actorConnectionId,
        string targetConnectionId,
        bool isAdmin)
    {
        var result = await _db.ScriptEvaluateAsync(
            RedisParticipantScripts.SetParticipantAdminScript,
            [RedisRoomKeys.Participants(roomId)],
            [actorConnectionId, targetConnectionId, isAdmin ? "1" : "0"]);
        var value = (string?)result;
        if (int.TryParse(value, out var status)) return new ParticipantActionResult(status, null);
        var participant = JsonSerializer.Deserialize<Participant>(value!, JsonOptions);
        return new ParticipantActionResult(participant is null ? 0 : 1, participant);
    }

    public async Task<bool> IsParticipantAsync(string roomId, string connectionId) =>
        await _db.HashExistsAsync(RedisRoomKeys.Participants(roomId), connectionId);

    public async Task<IReadOnlyList<Participant>> GetParticipantsAsync(string roomId)
    {
        var entries = await _db.HashGetAllAsync(RedisRoomKeys.Participants(roomId));
        if (entries.Length == 0)
            await _db.SetRemoveAsync(RedisRoomKeys.ActiveRooms, roomId);
        var participants = new List<Participant>();

        foreach (var entry in entries)
        {
            var p = JsonSerializer.Deserialize<Participant>((string)entry.Value!, JsonOptions);
            if (p is null) continue;
            var isLive = !string.IsNullOrEmpty(p.InstanceId) &&
                await _db.SetContainsAsync(RedisRoomKeys.InstanceConnections(p.InstanceId), p.ConnectionId);
            if (isLive) participants.Add(p);
            else await RemoveParticipantAsync(roomId, p.ConnectionId, p.InstanceId);
        }

        return participants;
    }

    public async Task<Participant?> GetParticipantAsync(string roomId, string connectionId)
    {
        var json = await _db.HashGetAsync(RedisRoomKeys.Participants(roomId), connectionId);
        return json.IsNullOrEmpty
            ? null
            : JsonSerializer.Deserialize<Participant>((string)json!, JsonOptions);
    }

    public async Task<string?> GetConnectionRoomAsync(string connectionId)
    {
        if (string.IsNullOrEmpty(connectionId)) return null;
        return (string?)await _db.StringGetAsync(RedisRoomKeys.ConnectionRoom(connectionId));
    }

    public async Task PruneInactiveRoomsAsync()
    {
        var activeRooms = await _db.SetMembersAsync(RedisRoomKeys.ActiveRooms);
        foreach (var roomId in activeRooms)
            await GetParticipantsAsync((string)roomId!);
    }

}
