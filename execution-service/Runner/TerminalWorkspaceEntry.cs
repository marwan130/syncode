namespace Syncode.ExecutionService.Runner;

public sealed record TerminalWorkspaceEntry(
    string Path,
    bool IsFolder,
    string Content,
    string? PreviousContent = null);

public sealed record TerminalWorkspaceChanges(
    IReadOnlyList<TerminalWorkspaceEntry> Entries,
    IReadOnlyList<TerminalWorkspaceEntry> DeletedEntries,
    IReadOnlyList<string> UnsupportedPaths);
