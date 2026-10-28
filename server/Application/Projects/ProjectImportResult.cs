namespace server.Application.Projects;

public sealed record ProjectImportResult(
    IReadOnlyList<ProjectTreeMutation> Operations,
    IReadOnlyList<ProjectTreeMutation> ChangedOperations,
    IReadOnlyList<ImportedProjectFileSnapshot> Files,
    string? ProjectRootName);

