namespace server.Application.Execution;

public sealed record RunExecutionRequest(
    string Language,
    string RequestId,
    string SourcePath);
