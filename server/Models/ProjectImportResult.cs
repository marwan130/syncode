namespace server.Models;

public sealed record ProjectImportResult(
    IReadOnlyList<ProjectTreeCreateOperation> Operations,
    IReadOnlyList<ProjectTreeCreateOperation> ChangedOperations,
    IReadOnlyList<ImportedProjectFileSnapshot> Files);

