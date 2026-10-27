namespace server.Application.Projects;

public sealed record ProjectImportFile(string Path, string Id, string CompressedSnapshot);

public sealed record ProjectTreeOperationId(string SiteId, long Counter);

public sealed record ProjectTreeEntry(string Id, string Name, string? ParentId, bool IsFolder);

public sealed record ProjectTreeCreateOperation(
    string Type,
    ProjectTreeOperationId OpId,
    ProjectTreeEntry Entry);
