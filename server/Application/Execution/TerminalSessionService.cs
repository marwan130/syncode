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

    }

    public async Task RunFileAsync(
        string connectionId,
        string sessionId,
        string language,
        string sourcePath,
        CancellationToken cancellationToken)
    {
        var roomId = await EnsureTerminalOwnerAsync(connectionId, sessionId);
        await authorization.EnsureCanEditAsync(roomId, connectionId);
        if (!sessions.AllowCommand(connectionId, roomId, sessionId))
            throw new RoomOperationException("Terminal input rate limit reached. Wait a moment and try again.");
        var normalizedLanguage = NormalizeLanguage(language);
        if (!ProjectPathRules.IsSafePath(sourcePath))
            throw new RoomOperationException("The active project file is invalid.");
        var entries = await workspace.MaterializeAsync(roomId);
        if (!entries.Any(file => file.Path == sourcePath && !file.IsFolder))
            throw new RoomOperationException("The active project file no longer exists.");
        await executionService.RunTerminalFileAsync(
            sessionId, normalizedLanguage, sourcePath, entries, cancellationToken);
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
