namespace Syncode.ExecutionService.Runner;

public enum ExecutionLanguage
{
    JavaScript,
    Python
}

public sealed record ExecutionJob(
    string Id,
    string RoomId,
    string RequestedBy,
    ExecutionLanguage Language,
    string Source,
    DateTimeOffset CreatedAt,
    string RequestId = "");

public enum ExecutionOutputStream
{
    StandardOutput,
    StandardError
}

public sealed record ExecutionOutputChunk(ExecutionOutputStream Stream, string Text);

public sealed record ExecutionResult(
    int ExitCode,
    bool TimedOut,
    bool OutputLimitExceeded,
    TimeSpan Duration);
