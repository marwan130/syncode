using Syncode.ExecutionService.Runner;

namespace Syncode.ExecutionService.Queue;

public sealed record QueueExecutionRequest(
    string RoomId,
    string RequestedBy,
    ExecutionLanguage Language,
    string Source,
    string? RequestId = null,
    string SourcePath = "",
    IReadOnlyList<ExecutionProjectFile>? ProjectFiles = null);
