namespace server.Services;

public sealed record RunExecutionRequest(
    string Language,
    string Source,
    string RequestId,
    string SourcePath,
    IReadOnlyList<ExecutionProjectFileInput>? ProjectFiles);
