using System.Text.Json.Serialization;

namespace server.Services;

internal sealed class GithubApiRepository
{
    [JsonPropertyName("default_branch")]
    public string DefaultBranch { get; init; } = "";
    [JsonPropertyName("private")]
    public bool IsPrivate { get; init; }
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

internal sealed class GithubRefResponse { }
