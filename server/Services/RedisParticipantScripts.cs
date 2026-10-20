namespace server.Services;

internal static class RedisParticipantScripts
{    internal const string AdmitParticipantScript = """
        if redis.call('EXISTS', KEYS[2]) == 0 then return -1 end
        local alreadyInRoom = redis.call('HEXISTS', KEYS[1], ARGV[1]) == 1
        if not alreadyInRoom then
            if redis.call('HLEN', KEYS[1]) >= tonumber(ARGV[4]) then return 0 end
            local roomIsActive = redis.call('SISMEMBER', KEYS[3], ARGV[5]) == 1
            if not roomIsActive and redis.call('SCARD', KEYS[3]) >= tonumber(ARGV[6]) then return -2 end
            local connectionExists = redis.call('SISMEMBER', KEYS[4], ARGV[1]) == 1
            if not connectionExists and redis.call('SCARD', KEYS[4]) >= tonumber(ARGV[7]) then return -3 end
        end
        local participant = cjson.decode(ARGV[2])
        if alreadyInRoom then
            local previous = cjson.decode(redis.call('HGET', KEYS[1], ARGV[1]))
            participant.IsAdmin = previous.IsAdmin or previous.isAdmin or false
            participant.IsLocked = previous.IsLocked or previous.isLocked or false
        else
            local hasCreatorToken = redis.call('HEXISTS', KEYS[2], 'creatorTokenHash') == 1
            if ARGV[8] == '1' then
                participant.IsAdmin = true
                participant.IsLocked = false
            elseif not hasCreatorToken then
                local hasAdmin = false
                for _, value in ipairs(redis.call('HVALS', KEYS[1])) do
                    local existing = cjson.decode(value)
                    if existing.IsAdmin or existing.isAdmin then
                        hasAdmin = true
                        break
                    end
                end
                if not hasAdmin then participant.IsAdmin = true end
            end
        end
        redis.call('HSET', KEYS[1], ARGV[1], cjson.encode(participant))
        redis.call('SADD', KEYS[3], ARGV[5])
        redis.call('SADD', KEYS[4], ARGV[1])
        redis.call('PEXPIRE', KEYS[4], 120000)
        redis.call('SET', KEYS[5], ARGV[5], 'EX', 86400)
        return 1
        """;
    internal const string RemoveParticipantScript = """
        redis.call('HDEL', KEYS[1], ARGV[1])
        if redis.call('GET', KEYS[3]) == ARGV[2] then
            redis.call('DEL', KEYS[3])
            redis.call('SREM', KEYS[4], ARGV[1])
        end
        if redis.call('HLEN', KEYS[1]) == 0 then
            redis.call('SREM', KEYS[2], ARGV[2])
        end
        return 1
        """;
    internal const string ToggleParticipantLockScript = """
        local actorValue = redis.call('HGET', KEYS[1], ARGV[1])
        if not actorValue then return '-2' end
        local actor = cjson.decode(actorValue)
        if not (actor.IsAdmin or actor.isAdmin) then return '-2' end

        local value = redis.call('HGET', KEYS[1], ARGV[2])
        if not value then return '0' end
        local participant = cjson.decode(value)
        if participant.IsAdmin or participant.isAdmin then return '-1' end
        local locked = participant.IsLocked or participant.isLocked or false
        participant.IsLocked = not locked
        local updated = cjson.encode(participant)
        redis.call('HSET', KEYS[1], ARGV[2], updated)
        return updated
        """;
    internal const string KickParticipantScript = """
        local actorValue = redis.call('HGET', KEYS[1], ARGV[1])
        if not actorValue then return '-1' end
        local actor = cjson.decode(actorValue)
        if not (actor.IsAdmin or actor.isAdmin) then return '-1' end
        if ARGV[1] == ARGV[2] then return '-2' end

        local targetValue = redis.call('HGET', KEYS[1], ARGV[2])
        if not targetValue then return '0' end
        local target = cjson.decode(targetValue)
        redis.call('HDEL', KEYS[1], ARGV[2])
        if redis.call('GET', KEYS[3]) == ARGV[3] then
            redis.call('DEL', KEYS[3])
        end
        if redis.call('HLEN', KEYS[1]) == 0 then
            redis.call('SREM', KEYS[2], ARGV[3])
        end
        return targetValue
        """;
    internal const string UpdateParticipantColorScript = """
        local value = redis.call('HGET', KEYS[1], ARGV[1])
        if not value then return '0' end
        local participant = cjson.decode(value)
        participant.Color = ARGV[2]
        local updated = cjson.encode(participant)
        redis.call('HSET', KEYS[1], ARGV[1], updated)
        return updated
        """;
    internal const string UpdateParticipantAvatarScript = """
        local value = redis.call('HGET', KEYS[1], ARGV[1])
        if not value then return '0' end
        local participant = cjson.decode(value)
        participant.AvatarUrl = ARGV[2] == '' and cjson.null or ARGV[2]
        local updated = cjson.encode(participant)
        redis.call('HSET', KEYS[1], ARGV[1], updated)
        return updated
        """;
    internal const string SetParticipantAdminScript = """
        local actorValue = redis.call('HGET', KEYS[1], ARGV[1])
        if not actorValue then return '-1' end
        local actor = cjson.decode(actorValue)
        if not (actor.IsAdmin or actor.isAdmin) then return '-1' end

        local targetValue = redis.call('HGET', KEYS[1], ARGV[2])
        if not targetValue then return '0' end
        local target = cjson.decode(targetValue)
        target.IsAdmin = ARGV[3] == '1'
        if target.IsAdmin then target.IsLocked = false end
        local updated = cjson.encode(target)
        redis.call('HSET', KEYS[1], ARGV[2], updated)
        return updated
        """;
    internal const string RegisterConnectionScript = """
        if redis.call('SISMEMBER', KEYS[1], ARGV[1]) == 1 then return 1 end
        if redis.call('SCARD', KEYS[1]) >= tonumber(ARGV[2]) then return 0 end
        redis.call('SADD', KEYS[1], ARGV[1])
        redis.call('PEXPIRE', KEYS[1], 120000)
        return 1
        """;

}
