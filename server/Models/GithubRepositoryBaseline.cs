namespace server.Models;

public sealed record GithubRepositoryBaseline(
    string Owner,
    string Name,
    string Branch,
    string BaseCommitSha,
    string BaseTreeSha,
    bool IsPrivate,
    IReadOnlyDictionary<string, string> FileBlobShas)
{
    public IReadOnlyDictionary<string, string> FileLineEndings { get; init; } =
        new Dictionary<string, string>(StringComparer.Ordinal);
}
