using System.Text.Json;

internal sealed class CrdtReplica(IEnumerable<CrdtOperation> operations)
{
    private readonly List<CrdtCharacter> _characters = [];

    public string GetVisibleText()
    {
        var pending = operations.ToList();
        while (pending.Count > 0)
        {
            var before = pending.Count;
            for (var index = pending.Count - 1; index >= 0; index--)
            {
                var operation = pending[index];
                if (operation.Type == "insert")
                {
                    var character = operation.Character!;
                    if (character.OriginId is not null && Find(character.OriginId) < 0) continue;
                    if (Find(character.Id) < 0) Insert(character);
                    pending.RemoveAt(index);
                }
                else
                {
                    var target = operation.Target!;
                    var targetIndex = Find(target);
                    if (targetIndex < 0) continue;
                    _characters[targetIndex] = _characters[targetIndex] with { IsDeleted = true };
                    pending.RemoveAt(index);
                }
            }
            if (pending.Count == before) throw new InvalidOperationException("The CRDT operation set contains an unresolved dependency.");
        }
        return string.Concat(_characters.Where(character => !character.IsDeleted).Select(character => character.Value));
    }

    public string ToSnapshot()
    {
        _ = GetVisibleText();
        var clock = _characters.Count == 0 ? 0 : _characters.Max(character => character.Id.Counter);
        return JsonSerializer.Serialize(
            new { clock, chars = _characters },
            new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });
    }

    private int Find(CrdtId id) => _characters.FindIndex(character => character.Id == id);

    private void Insert(CrdtCharacter character)
    {
        var originPosition = character.OriginId is null ? -1 : Find(character.OriginId);
        var insertPosition = originPosition + 1;
        while (insertPosition < _characters.Count)
        {
            var next = _characters[insertPosition];
            if (next.OriginId == character.OriginId)
            {
                if (Compare(character.Id, next.Id) > 0) break;
            }
            else
            {
                var nextOriginPosition = next.OriginId is null ? -1 : Find(next.OriginId);
                if (nextOriginPosition < originPosition) break;
            }
            insertPosition++;
        }
        _characters.Insert(insertPosition, character);
    }

    private static int Compare(CrdtId left, CrdtId right)
    {
        var counter = left.Counter.CompareTo(right.Counter);
        return counter != 0 ? counter : string.CompareOrdinal(left.SiteId, right.SiteId);
    }
}

internal sealed class CrdtReplicaSnapshot(string snapshot)
{
    public string GetVisibleText() => new CrdtReplica(ReadOperations()).GetVisibleText();

    public IReadOnlyList<CrdtOperation> ReadOperations()
    {
        using var document = JsonDocument.Parse(snapshot);
        var characters = document.RootElement.GetProperty("chars").EnumerateArray()
            .Select(character => new CrdtCharacter(
                ReadId(character.GetProperty("id")),
                character.GetProperty("value").GetString()!,
                character.GetProperty("originId").ValueKind == JsonValueKind.Null ? null : ReadId(character.GetProperty("originId")),
                character.GetProperty("isDeleted").GetBoolean()))
            .ToArray();
        var operations = characters.Select(character => new CrdtOperation("insert", character with { IsDeleted = false }, null)).ToList();
        operations.AddRange(characters.Where(character => character.IsDeleted)
            .Select(character => new CrdtOperation("delete", null, character.Id)));
        return operations;
    }

    private static CrdtId ReadId(JsonElement value) => new(
        value.GetProperty("siteId").GetString()!,
        value.GetProperty("counter").GetInt64());
}
