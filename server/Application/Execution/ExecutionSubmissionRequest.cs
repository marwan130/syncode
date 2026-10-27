namespace server.Application.Execution;

public sealed record ExecutionSubmissionRequest(
    string RoomId,
    string RequestedBy,
    string Language,
    string Source,
    string RequestId,
    string SourcePath,
    IReadOnlyList<ExecutionProjectFileInput> ProjectFiles);
