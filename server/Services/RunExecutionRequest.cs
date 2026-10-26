namespace server.Services;

public sealed record RunExecutionRequest(
    string Language,
    string RequestId,
    string SourcePath);
