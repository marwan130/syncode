using server.Application.Projects;
using StackExchange.Redis;

namespace server.Services;

public sealed class RedisProjectTreeStore : IProjectTreeOperationStore
{
    private readonly IDatabase _db;

    public RedisProjectTreeStore(IConnectionMultiplexer redis) => _db = redis.GetDatabase();
    private const string AppendProjectTreeOperationScript = """
        local okOperation, operation = pcall(cjson.decode, ARGV[2])
        if not okOperation or type(operation) ~= 'table' then return -2 end
        local counter = tonumber(ARGV[4])
        if type(operation.opId) ~= 'table' or operation.opId.siteId ~= ARGV[3] or operation.opId.counter ~= counter then return -2 end
        local previousCounter = tonumber(redis.call('HGET', KEYS[5], ARGV[3]) or '0')
        local merged = {}
        local function operationValue(operation)
            local opType = operation.type
            if opType == 'create' then
                local entry = operation.entry
                return cjson.encode({opType, entry.id, entry.name, entry.parentId, entry.isFolder})
            elseif opType == 'rename' then
                return cjson.encode({opType, operation.entryId, operation.name})
            elseif opType == 'move' then
                return cjson.encode({opType, operation.entryId, operation.parentId})
            elseif opType == 'delete' then
                return cjson.encode({opType, operation.entryId})
            end
            return nil
        end
        local lastOperation = redis.call('HGET', KEYS[6], ARGV[3])
        if counter == previousCounter and lastOperation then
            local okLast, last = pcall(cjson.decode, lastOperation)
            if okLast and operationValue(last) == operationValue(operation) then return 0 end
            return -1
        end
        local function mergeOperations(operations)
            for _, operation in ipairs(operations or {}) do
                local id = operation.opId.siteId .. ':' .. tostring(operation.opId.counter)
                local existingOperation = merged[id]
                if existingOperation and operationValue(existingOperation) ~= operationValue(operation) then return false end
                merged[id] = operation
            end
            return true
        end
        local savedSnapshot = redis.call('GET', KEYS[3])
        if savedSnapshot then
            local okSaved, saved = pcall(cjson.decode, savedSnapshot)
            if not okSaved or saved.version ~= 1 or type(saved.operations) ~= 'table' then return -2 end
            if not mergeOperations(saved.operations) then return -1 end
        end
        local operationId = operation.opId.siteId .. ':' .. tostring(operation.opId.counter)
        if operationId ~= ARGV[1] then return -2 end
        local existingOperation = merged[operationId]
        if existingOperation and operationValue(existingOperation) ~= operationValue(operation) then return -1 end
        if existingOperation then return 0 end
        local indexedOperation = redis.call('HGET', KEYS[2], ARGV[1])
        if indexedOperation then
            local okIndexed, indexed = pcall(cjson.decode, indexedOperation)
            if not okIndexed or operationValue(indexed) ~= operationValue(operation) then return -1 end
            return 0
        end
        if counter <= previousCounter then return 0 end
        merged[operationId] = operation
        if operation.type == 'create' then
            local entryId = operation.entry.id
            local existingCreate = redis.call('HGET', KEYS[4], entryId)
            if existingCreate and existingCreate ~= ARGV[1] then return -3 end
            if redis.call('HEXISTS', KEYS[7], entryId) == 1 then return -3 end
        end

        local function idGreater(left, right)
            if left.counter ~= right.counter then return left.counter > right.counter end
            return left.siteId > right.siteId
        end
        local creates, names, parents, deleted = {}, {}, {}, {}
        local function selectRegister(registers, id, value)
            local current = registers[id]
            if not current or idGreater(value.opId, current.opId) then registers[id] = value end
        end
        for _, candidate in pairs(merged) do
            local kind = candidate.type
            if kind == 'create' then
                local entry = candidate.entry
                selectRegister(creates, entry.id, {opId = candidate.opId, value = entry})
                selectRegister(names, entry.id, {opId = candidate.opId, value = entry.name})
                selectRegister(parents, entry.id, {opId = candidate.opId, value = entry.parentId})
            elseif kind == 'rename' then
                selectRegister(names, candidate.entryId, {opId = candidate.opId, value = candidate.name})
            elseif kind == 'move' then
                selectRegister(parents, candidate.entryId, {opId = candidate.opId, value = candidate.parentId})
            elseif kind == 'delete' then
                selectRegister(deleted, candidate.entryId, {opId = candidate.opId, value = true})
            end
        end
        local entryParents = {}
        for _, value in ipairs(redis.call('HVALS', KEYS[7])) do
            local okEntry, entry = pcall(cjson.decode, value)
            if not okEntry or type(entry) ~= 'table' then return -2 end
            local id = entry.id or entry.Id
            local parent = entry.parentId
            if parent == nil or parent == cjson.null then parent = entry.ParentId end
            if parent == cjson.null then parent = nil end
            if id then entryParents[id] = parent end
        end
        for entryId, create in pairs(creates) do
            entryParents[entryId] = parents[entryId] and parents[entryId].value or create.value.parentId
        end
        local activeCount = 0
        local depthRoot = nil
        if operation.type == 'create' then depthRoot = operation.entry.id end
        if operation.type == 'move' then depthRoot = operation.entryId end
        for entryId, parent in pairs(entryParents) do
            local hidden = deleted[entryId] ~= nil
            local visited = {}
            local depth = 1
            local containsDepthRoot = entryId == depthRoot
            local cycle = false
            local tooDeep = false
            while not hidden and parent and parent ~= cjson.null do
                if deleted[parent] then
                    hidden = true
                elseif visited[parent] then
                    cycle = true
                    break
                else
                    visited[parent] = true
                    if parent == depthRoot then containsDepthRoot = true end
                    depth = depth + 1
                    if depth > 32 then tooDeep = true end
                    parent = entryParents[parent]
                end
            end
            if not hidden and containsDepthRoot and tooDeep and not cycle then return -6 end
            if not hidden then activeCount = activeCount + 1 end
        end
        if operation.type == 'create' and activeCount > 500 then return -5 end
        local operations = {}
        for entryId, create in pairs(creates) do
            table.insert(operations, {type = 'create', opId = create.opId, entry = create.value})
            local name = names[entryId]
            if name and idGreater(name.opId, create.opId) then
                table.insert(operations, {type = 'rename', opId = name.opId, entryId = entryId, name = name.value})
            end
            local parent = parents[entryId]
            if parent and idGreater(parent.opId, create.opId) then
                table.insert(operations, {type = 'move', opId = parent.opId, entryId = entryId, parentId = parent.value})
            end
            local deletion = deleted[entryId]
            if deletion then table.insert(operations, {type = 'delete', opId = deletion.opId, entryId = entryId}) end
        end
        for entryId, name in pairs(names) do
            if not creates[entryId] then table.insert(operations, {type = 'rename', opId = name.opId, entryId = entryId, name = name.value}) end
        end
        for entryId, parent in pairs(parents) do
            if not creates[entryId] then table.insert(operations, {type = 'move', opId = parent.opId, entryId = entryId, parentId = parent.value}) end
        end
        for entryId, deletion in pairs(deleted) do
            if not creates[entryId] then table.insert(operations, {type = 'delete', opId = deletion.opId, entryId = entryId}) end
        end
        table.sort(operations, function(a, b)
            if a.opId.counter ~= b.opId.counter then return a.opId.counter < b.opId.counter end
            return a.opId.siteId < b.opId.siteId
        end)

        redis.call('HSET', KEYS[2], ARGV[1], ARGV[2])
        redis.call('RPUSH', KEYS[1], ARGV[1])
        if operation.type == 'create' then redis.call('HSET', KEYS[4], operation.entry.id, ARGV[1]) end
        local length = redis.call('LLEN', KEYS[1])
        if length > 1000 then
            local removed = redis.call('LPOP', KEYS[1], length - 1000)
            for _, id in ipairs(removed) do redis.call('HDEL', KEYS[2], id) end
        end
        redis.call('HSET', KEYS[5], ARGV[3], counter)
        redis.call('HSET', KEYS[6], ARGV[3], ARGV[2])
        redis.call('SET', KEYS[3], cjson.encode({version = 1, operations = operations}), 'EX', 86400)
        redis.call('EXPIRE', KEYS[1], 86400)
        redis.call('EXPIRE', KEYS[2], 86400)
        redis.call('EXPIRE', KEYS[4], 86400)
        redis.call('EXPIRE', KEYS[5], 86400)
        redis.call('EXPIRE', KEYS[6], 86400)
        return 1
        """;
    public async Task<int> AppendProjectTreeOperationAsync(
        string roomId,
        string operationId,
        string operationJson,
        string siteId,
        long counter)
    {
        var result = await _db.ScriptEvaluateAsync(
            AppendProjectTreeOperationScript,
            [ProjectTreeOperationsKey(roomId), ProjectTreeOperationIndexKey(roomId), ProjectTreeSnapshotKey(roomId),
                ProjectTreeEntryIndexKey(roomId), ProjectTreeSiteCounterKey(roomId), ProjectTreeSiteLastOperationKey(roomId),
                FilesKey(roomId)],
            [operationId, operationJson, siteId, counter]);
        return (int)result;
    }

    public async Task<IReadOnlyList<string>> GetProjectTreeOperationsAsync(string roomId)
    {
        var ids = await _db.ListRangeAsync(ProjectTreeOperationsKey(roomId));
        if (ids.Length == 0) return [];
        var operations = await _db.HashGetAsync(ProjectTreeOperationIndexKey(roomId), ids.Select(id => (RedisValue)id).ToArray());
        return operations.Where(value => value.HasValue).Select(value => (string)value!).ToArray();
    }

    public async Task<string?> GetProjectTreeOperationAsync(string roomId, string operationId) =>
        (string?)await _db.HashGetAsync(ProjectTreeOperationIndexKey(roomId), operationId);

    public async Task<string?> GetProjectTreeSnapshotAsync(string roomId) =>
        (string?)await _db.StringGetAsync(ProjectTreeSnapshotKey(roomId));

    private static string FilesKey(string roomId) => $"room:{roomId}:files";
    private static string ProjectTreeOperationsKey(string roomId) => $"room:{roomId}:project-tree:operations";
    private static string ProjectTreeOperationIndexKey(string roomId) => $"room:{roomId}:project-tree:index";
    private static string ProjectTreeSnapshotKey(string roomId) => $"room:{roomId}:project-tree:snapshot";
    private static string ProjectTreeEntryIndexKey(string roomId) => $"room:{roomId}:project-tree:entry-index";
    private static string ProjectTreeSiteCounterKey(string roomId) => $"room:{roomId}:project-tree:site-counters";
    private static string ProjectTreeSiteLastOperationKey(string roomId) => $"room:{roomId}:project-tree:site-last-operations";
    private static string FileSnapshotKey(string roomId, string fileId) => $"room:{roomId}:file:{fileId}:snapshot";
}
