namespace server.Services;

public sealed record TerminalOutputResult(string Text, int Offset, bool Exited, int? ExitCode);
