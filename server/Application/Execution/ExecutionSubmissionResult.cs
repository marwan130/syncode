namespace server.Application.Execution;

public sealed record ExecutionSubmissionResult(string JobId, int QueuePosition);
