namespace server.Services;

public sealed record ExecutionOutputMessage(
    string RoomId,
    string JobId,
    string RequestId,
    string Type,
    string? Stream = null,
    string? Text = null,
    int? ExitCode = null,
    bool? TimedOut = null,
    bool? OutputLimitExceeded = null);
