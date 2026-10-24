namespace server.Services;

public sealed class CollabHubServices(
    RedisParticipantStore participants,
    RoomJoinService join,
    ExecutionServiceClient execution,
    TerminalSessionRegistry terminalSessions,
    ProjectImportService projectImport,
    GithubRepositoryAccessStore githubRepositoryAccess,
    TerminalSessionService terminal,
    RoomInteractionService interactions,
    RedisRoomJoinApprovalStore joinApprovals)
{
    public RedisParticipantStore Participants { get; } = participants;
    public RoomJoinService Join { get; } = join;
    public ExecutionServiceClient Execution { get; } = execution;
    public TerminalSessionRegistry TerminalSessions { get; } = terminalSessions;
    public ProjectImportService ProjectImport { get; } = projectImport;
    public GithubRepositoryAccessStore GithubRepositoryAccess { get; } = githubRepositoryAccess;
    public TerminalSessionService Terminal { get; } = terminal;
    public RoomInteractionService Interactions { get; } = interactions;
    public RedisRoomJoinApprovalStore JoinApprovals { get; } = joinApprovals;
}
