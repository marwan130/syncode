namespace Syncode.ExecutionService.Queue;

public sealed record ExecutionEnqueueResult(string? JobId, int QueuePosition, bool IsFull, bool IsDuplicate);
