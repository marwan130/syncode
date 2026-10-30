using System.Text.RegularExpressions;
using System.Text;
using server.Models;

namespace server.Services;

public sealed class GithubRepositoryBrowserService(
    GithubApiClient github,
    GithubOAuthService oauth)
{
    private static readonly UTF8Encoding StrictUtf8 = new(false, true);

    public async Task<IReadOnlyList<GithubRepositorySummary>> ListRepositoriesAsync(
        string? sessionId,
        CancellationToken cancellationToken)
    {
        var (token, _) = await GetSessionAsync(sessionId, cancellationToken);
        var repositories = await github.GetAsync<List<GithubApiRepository>>(
            "user/repos?per_page=100&sort=updated",
            token,
            cancellationToken);
        return repositories
            .Where(repository => IsValidRepository(repository.Owner.Login, repository.Name))
            .Select(repository => new GithubRepositorySummary(
                repository.Owner.Login,
                repository.Name,
                repository.DefaultBranch,
                repository.IsPrivate,
                repository.UpdatedAt))
            .ToArray();
    }

    public async Task<IReadOnlyList<GithubBranchSummary>> ListBranchesAsync(
        string owner,
        string name,
        string? sessionId,
        CancellationToken cancellationToken)
    {
        if (!IsValidRepository(owner, name))
            throw new GithubRepositoryException("The GitHub repository is invalid.", 400);
        var (token, _) = await GetSessionAsync(sessionId, cancellationToken);
        var branches = await github.GetAsync<List<GithubApiBranch>>(
            $"repos/{owner}/{name}/branches?per_page=100",
            token,
            cancellationToken);
        return branches
            .Where(branch => branch.Name.Length <= 255 && GithubRepositoryRules.IsSha(branch.Commit.Sha))
            .Select(branch => new GithubBranchSummary(branch.Name, branch.Commit.Sha, branch.IsProtected))
            .ToArray();
    }

    public async Task<IReadOnlyList<GithubCommitSummary>> ListHistoryAsync(
        string owner,
        string name,
        string branch,
        int page,
        string? sessionId,
        CancellationToken cancellationToken)
    {
        ValidateRepositoryAndBranch(owner, name, branch);
        var (token, _) = await GetSessionAsync(sessionId, cancellationToken);
        var commits = await github.GetAsync<List<GithubApiCommitHistoryItem>>(
            $"repos/{owner}/{name}/commits?sha={Uri.EscapeDataString(branch)}&per_page=100&page={page}",
            token,
            cancellationToken);
        return commits
            .Where(commit => GithubRepositoryRules.IsSha(commit.Sha))
            .Select(commit => new GithubCommitSummary(
                commit.Sha,
                commit.Commit.Message,
                commit.Author?.Login ?? commit.Commit.Author.Name,
                commit.Commit.Author.Date,
                commit.Parents.Select(parent => parent.Sha).ToArray()))
            .ToArray();
    }

    public async Task<GithubCommitDetailsSummary> GetCommitDetailsAsync(
        string owner,
        string name,
        string sha,
        string? sessionId,
        CancellationToken cancellationToken)
    {
        if (!IsValidRepository(owner, name) || !Regex.IsMatch(sha, "^[a-fA-F0-9]{40}$"))
            throw new GithubRepositoryException("The GitHub commit reference is invalid.", 400);
        var (token, _) = await GetSessionAsync(sessionId, cancellationToken);
        var commit = await github.GetAsync<GithubApiCommitDetailsItem>(
            $"repos/{owner}/{name}/commits/{sha}",
            token,
            cancellationToken);
        return new GithubCommitDetailsSummary(
            commit.Files.Count,
            Math.Max(0, commit.Stats.Additions),
            Math.Max(0, commit.Stats.Deletions));
    }

    public async Task<GithubRepositoryFileContent> GetFileContentAsync(
        string owner,
        string name,
        string sha,
        string? sessionId,
        CancellationToken cancellationToken)
    {
        if (!IsValidRepository(owner, name) || !Regex.IsMatch(sha, "^[a-fA-F0-9]{40}$"))
            throw new GithubRepositoryException("The GitHub file reference is invalid.", 400);
        var (token, _) = await GetSessionAsync(sessionId, cancellationToken);
        var blob = await github.GetAsync<GithubBlobResponse>(
            $"repos/{owner}/{name}/git/blobs/{sha}", token, cancellationToken, 128 * 1024);
        if (!string.Equals(blob.Encoding, "base64", StringComparison.OrdinalIgnoreCase) ||
            blob.Size is < 0 or > GithubRepositoryRules.MaxFileBytes ||
            string.IsNullOrEmpty(blob.Content))
            throw new GithubRepositoryException("This file is too large or cannot be shown as text.", 413);
        try
        {
            var bytes = Convert.FromBase64String(blob.Content);
            if (bytes.Length != blob.Size || bytes.Contains((byte)0))
                throw new GithubRepositoryException("This file cannot be shown as text.", 422);
            return new GithubRepositoryFileContent(StrictUtf8.GetString(bytes));
        }
        catch (FormatException)
        {
            throw new GithubRepositoryException("GitHub returned an invalid file.", 502);
        }
        catch (DecoderFallbackException)
        {
            throw new GithubRepositoryException("This file cannot be shown as text.", 422);
        }
    }

    public async Task<GithubBranchSummary> CreateBranchAsync(
        GithubBranchRequest request,
        string? sessionId,
        CancellationToken cancellationToken)
    {
        ValidateRepositoryAndBranch(request.Owner, request.Name, request.Branch);
        var source = string.IsNullOrWhiteSpace(request.SourceBranch)
            ? "HEAD"
            : request.SourceBranch.Trim();
        if (source.Length > 255)
            throw new GithubRepositoryException("The source branch is invalid.", 400);
        var (token, _) = await GetWriteSessionAsync(request.Owner, request.Name, sessionId, cancellationToken);
        var sourceCommit = await GetBranchCommitAsync(request.Owner, request.Name, source, token, cancellationToken);
        await github.PostAsync<GithubRefResponse>(
            $"repos/{request.Owner}/{request.Name}/git/refs",
            token,
            new { @ref = $"refs/heads/{request.Branch}", sha = sourceCommit.Sha },
            cancellationToken);
        return new GithubBranchSummary(request.Branch, sourceCommit.Sha, false);
    }

    public async Task RenameBranchAsync(
        GithubRenameBranchRequest request,
        string? sessionId,
        CancellationToken cancellationToken)
    {
        ValidateRepositoryAndBranch(request.Owner, request.Name, request.Branch);
        ValidateRepositoryAndBranch(request.Owner, request.Name, request.NewName);
        if (request.Branch == request.NewName)
            throw new GithubRepositoryException("Choose a different branch name.", 400);
        var (token, _) = await GetWriteSessionAsync(request.Owner, request.Name, sessionId, cancellationToken);
        var repository = await GetRepositoryAsync(request.Owner, request.Name, token, cancellationToken);
        if (repository.DefaultBranch == request.Branch)
            throw new GithubRepositoryException("The default branch cannot be renamed here.", 409);
        var sourceCommit = await GetBranchCommitAsync(request.Owner, request.Name, request.Branch, token, cancellationToken);
        await github.PostAsync<GithubRefResponse>(
            $"repos/{request.Owner}/{request.Name}/git/refs",
            token,
            new { @ref = $"refs/heads/{request.NewName}", sha = sourceCommit.Sha },
            cancellationToken);
        await github.DeleteAsync(
            $"repos/{request.Owner}/{request.Name}/git/refs/heads/{Uri.EscapeDataString(request.Branch)}",
            token,
            cancellationToken);
    }

    public async Task DeleteBranchAsync(
        string owner,
        string name,
        string branch,
        string? sessionId,
        CancellationToken cancellationToken)
    {
        ValidateRepositoryAndBranch(owner, name, branch);
        var (token, _) = await GetWriteSessionAsync(owner, name, sessionId, cancellationToken);
        var repository = await GetRepositoryAsync(owner, name, token, cancellationToken);
        if (repository.DefaultBranch == branch)
            throw new GithubRepositoryException("The default branch cannot be deleted.", 409);
        await github.DeleteAsync(
            $"repos/{owner}/{name}/git/refs/heads/{Uri.EscapeDataString(branch)}",
            token,
            cancellationToken);
    }

    private async Task<(string Token, IReadOnlyList<string> Scopes)> GetSessionAsync(
        string? sessionId,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(sessionId))
            throw new GithubOAuthException("Sign in with GitHub to browse repositories.", true);
        return await oauth.GetAccessTokenAsync(sessionId, cancellationToken);
    }

    private async Task<(string Token, IReadOnlyList<string> Scopes)> GetWriteSessionAsync(
        string owner,
        string name,
        string? sessionId,
        CancellationToken cancellationToken)
    {
        var session = await GetSessionAsync(sessionId, cancellationToken);
        var repository = await GetRepositoryAsync(owner, name, session.Token, cancellationToken);
        if (!GithubOAuthService.HasRequiredRepositoryScope(session.Scopes, repository.IsPrivate))
            throw new GithubRepositoryException("Authorize GitHub repository access before changing branches.", 403);
        return session;
    }

    private async Task<GithubApiRepository> GetRepositoryAsync(
        string owner,
        string name,
        string token,
        CancellationToken cancellationToken) =>
        await github.GetAsync<GithubApiRepository>(
            $"repos/{owner}/{name}", token, cancellationToken);

    private async Task<GithubCommitResponse> GetBranchCommitAsync(
        string owner,
        string name,
        string branch,
        string token,
        CancellationToken cancellationToken) =>
        await github.GetAsync<GithubCommitResponse>(
            $"repos/{owner}/{name}/commits/{Uri.EscapeDataString(branch)}",
            token,
            cancellationToken);

    private static void ValidateRepositoryAndBranch(string owner, string name, string branch)
    {
        if (!IsValidRepository(owner, name) || !GithubRepositoryRules.IsValidBranch(branch))
            throw new GithubRepositoryException("The GitHub repository or branch is invalid.", 400);
    }

    private static bool IsValidRepository(string? owner, string? name) =>
        owner is { Length: >= 1 and <= 39 } && Regex.IsMatch(owner, "^[A-Za-z0-9-]+$") &&
        name is { Length: >= 1 and <= 100 } && name is not "." and not ".." &&
        Regex.IsMatch(name, "^[A-Za-z0-9._-]+$");
}
