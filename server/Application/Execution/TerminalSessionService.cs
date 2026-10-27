using System.Text;
using server.Application.Projects;
using server.Application.Rooms;

namespace server.Application.Execution;

public sealed class TerminalSessionService(
    IRoomParticipantReader participants,
    IExecutionGateway executionService,
    ITerminalSessionRegistry sessions,
    RoomAuthorizationService authorization,
    RoomWorkspaceAdapter workspace)
{
    public async Task<TerminalSessionStartResult> StartAsync(string connectionId, CancellationToken cancellationToken)
    {
        var roomId = await GetParticipantRoomAsync(connectionId, "Join a room before opening a terminal.");
        await authorization.EnsureCanEditAsync(roomId, connectionId);
        var entries = await workspace.MaterializeAsync(roomId);
        var session = await executionService.StartTerminalAsync(roomId, entries, cancellationToken);
        if (sessions.TryAdd(connectionId, roomId, session.SessionId)) return session;
        await executionService.CloseTerminalAsync(session.SessionId, cancellationToken);
        throw new RoomOperationException("You can have up to three terminal tabs open at once.");
    }

    public async Task WriteInputAsync(string connectionId, string sessionId, string input, CancellationToken cancellationToken)
    {
        var roomId = await EnsureTerminalOwnerAsync(connectionId, sessionId);
        await authorization.EnsureCanEditAsync(roomId, connectionId);
        if (string.IsNullOrEmpty(input) || input.Length > 4096 || !sessions.AllowCommand(connectionId, roomId, sessionId))
            throw new RoomOperationException("Terminal input rate limit reached. Wait a moment and try again.");
        await executionService.WriteTerminalInputAsync(sessionId, input, cancellationToken);
    }

    public async Task<TerminalOutputResult> ReadOutputAsync(
        string connectionId, string sessionId, int offset, CancellationToken cancellationToken)
    {
        var roomId = await EnsureTerminalOwnerAsync(connectionId, sessionId);
        await authorization.EnsureCanEditAsync(roomId, connectionId);
        if (!sessions.AllowPoll(connectionId, roomId, sessionId))
            throw new RoomOperationException("Terminal output is being requested too quickly.");
        return await executionService.ReadTerminalOutputAsync(sessionId, offset, cancellationToken);
    }

    public async Task CloseAsync(string connectionId, string sessionId, CancellationToken cancellationToken)
    {
        var roomId = await EnsureTerminalOwnerAsync(connectionId, sessionId);
        sessions.Remove(connectionId, roomId, sessionId);
        await executionService.CloseTerminalAsync(sessionId, cancellationToken);
    }

    public async Task CloseConnectionSessionsAsync(string connectionId)
    {
        foreach (var sessionId in sessions.RemoveAll(connectionId))
        {
            try { await executionService.CloseTerminalAsync(sessionId, CancellationToken.None); }
            catch (RoomOperationException) { }
        }

        foreach (var jobId in sessions.RemoveExecutions(connectionId))
        {
            try { await executionService.CancelExecutionAsync(jobId, CancellationToken.None); }
            catch (RoomOperationException) { }
        }
    }

    public async Task<ExecutionSubmissionResult> RunAsync(
        string connectionId, RunExecutionRequest request, CancellationToken cancellationToken)
    {
        var roomId = await GetParticipantRoomAsync(connectionId, "Join a room before running code.");
        if (!Guid.TryParse(request.RequestId, out var requestGuid))
            throw new RoomOperationException("Invalid execution request.");
        await authorization.EnsureCanEditAsync(roomId, connectionId);
        var language = NormalizeLanguage(request.Language);
        var participant = await participants.GetParticipantAsync(roomId, connectionId)
            ?? throw new RoomOperationException("Join a room before running code.");
        if (!ProjectPathRules.IsSafePath(request.SourcePath))
            throw new RoomOperationException("The active project file is invalid.");
        var workspaceEntries = await workspace.MaterializeAsync(roomId);
        var projectFiles = workspaceEntries
            .Where(entry => !entry.IsFolder)
            .Select(entry => new ExecutionProjectFileInput(entry.Path, entry.Content))
            .ToArray();
        var activeFile = projectFiles.FirstOrDefault(file => file.Path == request.SourcePath)
            ?? throw new RoomOperationException("The active project file no longer exists.");
        ValidateProjectFiles(request.SourcePath, activeFile.Content, projectFiles);
        var submission = await executionService.SubmitAsync(
            new ExecutionSubmissionRequest(
                roomId,
                participant.UserId ?? participant.DisplayName,
                language,
                activeFile.Content,
                requestGuid.ToString("N"),
                request.SourcePath,
                projectFiles),
            CancellationToken.None);
        if (cancellationToken.IsCancellationRequested || !sessions.TryAddExecution(connectionId, roomId, submission.JobId))
        {
            await executionService.CancelExecutionAsync(submission.JobId, CancellationToken.None);
            cancellationToken.ThrowIfCancellationRequested();
            throw new RoomOperationException("Could not attach an interactive terminal to this run.");
        }
        if (cancellationToken.IsCancellationRequested && sessions.RemoveExecution(submission.JobId))
            await executionService.CancelExecutionAsync(submission.JobId, CancellationToken.None);
        return submission;
    }

    public async Task WriteExecutionInputAsync(
        string connectionId, string jobId, string input, CancellationToken cancellationToken)
    {
        var roomId = await GetParticipantRoomAsync(connectionId, "Join a room before using the terminal.");
        await authorization.EnsureCanEditAsync(roomId, connectionId);
        if (jobId.Length != 32 || !jobId.All(Uri.IsHexDigit) || !sessions.OwnsExecution(connectionId, roomId, jobId))
            throw new RoomOperationException("Execution not found.");
        if (string.IsNullOrEmpty(input) || input.Length > 1024 || !sessions.AllowExecutionInput(connectionId, roomId, jobId))
            throw new RoomOperationException("Terminal input rate limit reached. Wait a moment and try again.");
        await executionService.WriteExecutionInputAsync(jobId, input, cancellationToken);
    }

    public async Task CancelExecutionAsync(
        string connectionId, string jobId, CancellationToken cancellationToken)
    {
        var roomId = await GetParticipantRoomAsync(connectionId, "Join a room before stopping code.");
        if (jobId.Length != 32 || !jobId.All(Uri.IsHexDigit) ||
            !sessions.TryRemoveExecution(connectionId, roomId, jobId))
            throw new RoomOperationException("Execution not found.");
        await executionService.CancelExecutionAsync(jobId, cancellationToken);
    }

    private async Task<string> EnsureTerminalOwnerAsync(string connectionId, string sessionId)
    {
        var roomId = await GetParticipantRoomAsync(connectionId, "Join a room before using a terminal.");
        if (sessionId.Length != 32 || !sessionId.All(Uri.IsHexDigit) ||
            !sessions.Owns(connectionId, roomId, sessionId))
            throw new RoomOperationException("Terminal session not found.");
        return roomId;
    }

    private async Task<string> GetParticipantRoomAsync(string connectionId, string error)
    {
        var roomId = await participants.GetConnectionRoomAsync(connectionId);
        if (string.IsNullOrEmpty(roomId) || !await participants.IsParticipantAsync(roomId, connectionId))
            throw new RoomOperationException(error);
        return roomId;
    }

    private static void ValidateProjectFiles(
        string sourcePath,
        string source,
        IReadOnlyList<ExecutionProjectFileInput> files)
    {
        if (Encoding.UTF8.GetByteCount(source) > RoomWorkspaceAdapter.MaximumWorkspaceBytes)
            throw new RoomOperationException("The project exceeds the 32 MB run limit.");
        if (files.Count is < 1 or > 500 || !ProjectPathRules.IsSafePath(sourcePath))
            throw new RoomOperationException("Invalid project files for execution.");
        if (!files.Any(file => file.Path == sourcePath))
            throw new RoomOperationException("The active file is missing from the project run.");

        long projectBytes = 0;
        var paths = new HashSet<string>(StringComparer.Ordinal);
        foreach (var file in files)
        {
            if (file is null || !ProjectPathRules.IsSafePath(file.Path) || file.Content is null || !paths.Add(file.Path))
                throw new RoomOperationException("Invalid project files for execution.");
            projectBytes += Encoding.UTF8.GetByteCount(file.Content);
        }

        var activeFile = files.First(file => file.Path == sourcePath);
        var totalBytes = projectBytes - Encoding.UTF8.GetByteCount(activeFile.Content) + Encoding.UTF8.GetByteCount(source);
        if (totalBytes > RoomWorkspaceAdapter.MaximumWorkspaceBytes)
            throw new RoomOperationException("The project exceeds the 32 MB run limit.");
    }

    private static string NormalizeLanguage(string? language) => language?.Trim().ToLowerInvariant() switch
    {
        "javascript" => "JavaScript",
        "typescript" => "TypeScript",
        "python" => "Python",
        "csharp" or "c#" => "CSharp",
        "c" => "C",
        "cpp" or "c++" => "Cpp",
        "rust" => "Rust",
        "java" => "Java",
        _ => throw new RoomOperationException("This file type cannot be run in the terminal."),
    };
}
