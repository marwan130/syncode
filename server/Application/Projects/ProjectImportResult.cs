namespace server.Application.Projects;

public sealed record ProjectImportResult(
    IReadOnlyList<ProjectTreeCreateOperation> Operations,
    IReadOnlyList<ProjectTreeCreateOperation> ChangedOperations,
    IReadOnlyList<ImportedProjectFileSnapshot> Files,
    string? ProjectRootName);

