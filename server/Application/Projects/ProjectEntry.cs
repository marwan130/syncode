namespace server.Application.Projects;

public sealed record ProjectEntry(string Id, string Name, string? ParentId, bool IsFolder);
