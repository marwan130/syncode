using server.Application.Projects;

namespace server.Models;

public sealed record GithubRepositoryImportRequest(
    string RoomId,
    string AccessKey,
    string Owner,
    string Name,
    string? Branch);

public sealed record GithubRepositoryFile(
    string Path,
    string Content,
    string BlobSha,
    long Size);

public sealed record GithubSkippedFile(string Path, string Reason);

public sealed record GithubRepositoryImportResponse(
    GithubRepositoryBaseline Baseline,
    IReadOnlyList<GithubRepositoryFile> Files,
    IReadOnlyList<GithubSkippedFile> Skipped);

public sealed record GithubFileChange(string Path, string? Content, bool Deleted);

public sealed record GithubPushRequest(
    string RoomId,
    string AccessKey,
    string Message,
    IReadOnlyList<GithubFileChange> Changes,
    string? BranchName);

public sealed record GithubRepositoryCreateRequest(
    string RoomId,
    string AccessKey,
    string Name,
    string Message,
    bool IsPrivate);

public sealed record GithubPushResponse(
    GithubRepositoryBaseline Baseline,
    string BranchUrl,
    string CompareUrl,
    string CommitSha);

public sealed record GithubRepositorySummary(
    string Owner,
    string Name,
    string DefaultBranch,
    bool IsPrivate,
    DateTimeOffset UpdatedAt);

public sealed record GithubBranchSummary(string Name, string Sha, bool IsProtected);

public sealed record GithubCommitSummary(
    string Sha,
    string Message,
    string Author,
    DateTimeOffset? Date,
    IReadOnlyList<string> Parents);

public sealed record GithubCommitDetailsSummary(
    int FilesChanged,
    int Insertions,
    int Deletions);

public sealed record GithubRepositoryFileContent(string Content);

public sealed record GithubBranchRequest(
    string Owner,
    string Name,
    string Branch,
    string? SourceBranch = null);

public sealed record GithubRenameBranchRequest(
    string Owner,
    string Name,
    string Branch,
    string NewName);

public sealed class GithubRepositoryException : Exception
{
    public GithubRepositoryException() : this("GitHub repository operation failed.", 500) { }

    public GithubRepositoryException(string message) : this(message, 500) { }

    public GithubRepositoryException(string message, Exception innerException)
        : base(message, innerException) => StatusCode = 500;

    public GithubRepositoryException(string message, int statusCode)
        : base(message) => StatusCode = statusCode;

    public int StatusCode { get; }
    public string Code => StatusCode switch
    {
        StatusCodes.Status401Unauthorized => "reauthorize",
        StatusCodes.Status403Forbidden => "scope_required",
        StatusCodes.Status404NotFound => "repository_unavailable",
        StatusCodes.Status409Conflict => "branch_moved",
        StatusCodes.Status422UnprocessableEntity => "invalid_branch",
        StatusCodes.Status413PayloadTooLarge => "import_too_large",
        StatusCodes.Status429TooManyRequests => "rate_limited",
        _ => "github_request_failed",
    };
}
