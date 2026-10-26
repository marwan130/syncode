namespace server.Services;

public sealed record TerminalOutputResult(
    string Text,
    int Offset,
    bool Exited,
    int? ExitCode,
    IReadOnlyList<RoomWorkspaceEntry> ChangedEntries,
    IReadOnlyList<RoomWorkspaceEntry> DeletedEntries,
    IReadOnlyList<string> UnsupportedPaths);
