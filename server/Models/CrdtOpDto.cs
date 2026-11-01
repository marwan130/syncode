namespace server.Models;

public class CrdtOpDto
{
    public string Type { get; set; } = string.Empty;
    public CrdtCharDto? Char { get; set; }
    public CrdtIdDto? Id { get; set; }
}

public sealed class CrdtCharDto
{
    public CrdtIdDto? Id { get; set; }
    public string Value { get; set; } = string.Empty;
    public CrdtIdDto? OriginId { get; set; }
    public bool IsDeleted { get; set; }
}

public sealed class CrdtIdDto
{
    public string SiteId { get; set; } = string.Empty;
    public long Counter { get; set; }
}
