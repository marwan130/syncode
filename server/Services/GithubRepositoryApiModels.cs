using System.Text.Json.Serialization;

namespace server.Services;

internal sealed class GithubApiRepository
{
    public string Name { get; init; } = "";
    public GithubRepositoryOwner Owner { get; init; } = new();
    [JsonPropertyName("full_name")]
    public string FullName { get; init; } = "";
    [JsonPropertyName("updated_at")]
    public DateTimeOffset UpdatedAt { get; init; }
    [JsonPropertyName("default_branch")]
    public string DefaultBranch { get; init; } = "";
    [JsonPropertyName("private")]
    public bool IsPrivate { get; init; }
}

internal sealed class GithubRepositoryOwner
{
    public string Login { get; init; } = "";
}

internal sealed class GithubApiBranch
{
    public string Name { get; init; } = "";
    public GithubApiBranchCommit Commit { get; init; } = new();
    [JsonPropertyName("protected")]
    public bool IsProtected { get; init; }
}

internal sealed class GithubApiBranchCommit
{
    public string Sha { get; init; } = "";
}

internal sealed class GithubApiCommitHistoryItem
{
    public string Sha { get; init; } = "";
    public GithubApiCommitDetails Commit { get; init; } = new();
    public GithubApiGitHubUser? Author { get; init; }
    public List<GithubApiCommitParent> Parents { get; init; } = [];
}

internal sealed class GithubApiCommitDetailsItem
{
    public GithubApiCommitStats Stats { get; init; } = new();
    public List<GithubApiCommitFile> Files { get; init; } = [];
}

internal sealed class GithubApiCommitStats
{
    public int Additions { get; init; }
    public int Deletions { get; init; }
}

internal sealed class GithubApiCommitFile
{
    public string Filename { get; init; } = "";
}

internal sealed class GithubApiCommitParent
{
    public string Sha { get; init; } = "";
}

internal sealed class GithubApiCommitDetails
{
    public string Message { get; init; } = "";
    public GithubApiCommitAuthor Author { get; init; } = new();
}

internal sealed class GithubApiCommitAuthor
{
    public string Name { get; init; } = "";
    public DateTimeOffset? Date { get; init; }
}

internal sealed class GithubApiGitHubUser
{
    public string Login { get; init; } = "";
}

internal sealed class GithubCommitResponse
{
    public string Sha { get; init; } = "";
    public GithubCommitData Commit { get; init; } = new();
}

internal sealed class GithubCommitData
{
    public GithubTreeReference Tree { get; init; } = new();
}

internal sealed class GithubTreeReference
{
    public string Sha { get; init; } = "";
}

internal sealed class GithubTreeResponse
{
    public bool Truncated { get; init; }
    [JsonPropertyName("tree")]
    public List<GithubTreeEntry> Entries { get; init; } = [];
}

internal sealed class GithubTreeEntry
{
    public string Path { get; init; } = "";
    public string Type { get; init; } = "";
    public string Mode { get; init; } = "";
    public string Sha { get; init; } = "";
    public long Size { get; init; }
}

internal sealed class GithubBlobResponse
{
    public string Encoding { get; init; } = "";
    public string Content { get; init; } = "";
    public long Size { get; init; }
}

internal sealed class GithubCreatedTreeResponse
{
    public string Sha { get; init; } = "";
    public List<GithubCreatedTreeEntry> Tree { get; init; } = [];
}

internal sealed class GithubCreatedTreeEntry
{
    public string Path { get; init; } = "";
    public string Sha { get; init; } = "";
}

internal sealed class GithubCommitCreatedResponse
{
    public string Sha { get; init; } = "";
}

internal sealed class GithubRefResponse
{
    public GithubApiBranchCommit Object { get; init; } = new();
}
