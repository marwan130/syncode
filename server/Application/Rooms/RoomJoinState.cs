using server.Application.Projects;

namespace server.Application.Rooms;

public sealed record RoomJoinState(
    string DisplayName,
    string Color,
    IReadOnlyList<ProjectEntry> Files,
    string? ProjectTreeSnapshot,
    IReadOnlyList<string> ProjectTreeHistoryItems,
    IReadOnlyList<string> ProjectFileIds,
    IReadOnlyDictionary<string, string> FileSnapshots,
    IReadOnlyList<Participant> Participants,
    IReadOnlyList<ChatMessage> ChatMessages,
    string? PeerConnectionId,
    GithubRepositoryBaseline? GithubRepository,
    string? ProjectRootName);
