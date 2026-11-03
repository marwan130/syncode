using System.Text.Json;

internal sealed record CrdtId(string SiteId, long Counter);
internal sealed record CrdtCharacter(CrdtId Id, string Value, CrdtId? OriginId, bool IsDeleted);
internal sealed record TimedOperation(string Key, CrdtOperation Operation);

internal sealed record CrdtOperation(string Type, CrdtCharacter? Character, CrdtId? Target)
{
    public string? SiteId => Type == "insert" ? Character?.Id.SiteId : Target?.SiteId;

    public string Key => Type == "insert"
        ? $"insert:{Character!.Id.SiteId}:{Character.Id.Counter}"
        : $"delete:{Target!.SiteId}:{Target.Counter}";

    public static CrdtOperation Insert(CrdtId id, string value, CrdtId? origin) =>
        new("insert", new CrdtCharacter(id, value, origin, false), null);

    public static CrdtOperation Delete(CrdtId target) => new("delete", null, target);

    public object ToWirePayload() => Type == "insert"
        ? new { type = Type, @char = new { id = Character!.Id, value = Character.Value, originId = Character.OriginId, isDeleted = false } }
        : new { type = Type, id = Target, @char = (object?)null };

    public static CrdtOperation Parse(JsonElement raw)
    {
        var type = raw.GetProperty("type").GetString();
        if (type == "insert")
        {
            var character = raw.GetProperty("char");
            var origin = character.GetProperty("originId");
            return Insert(
                ReadId(character.GetProperty("id")),
                character.GetProperty("value").GetString()!,
                origin.ValueKind == JsonValueKind.Null ? null : ReadId(origin));
        }
        if (type == "delete") return new CrdtOperation("delete", null, ReadId(raw.GetProperty("id")));
        throw new InvalidOperationException("The server sent an unsupported CRDT operation.");
    }

    private static CrdtId ReadId(JsonElement value) => new(
        value.GetProperty("siteId").GetString()!,
        value.GetProperty("counter").GetInt64());
}
