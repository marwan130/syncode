using server.Application.Projects;
using server.Models;

namespace server.Services;

public sealed class GithubRepositoryPushService(
    GithubApiClient github,
    GithubOAuthService oauth,
    RedisRoomMetadataStore rooms,
    RedisRoomRateLimitStore rateLimits,
    GithubRepositoryStore repositories,
    IProjectTreeStateReader treeState,
    IRoomEventPublisher events)
{
    public async Task<GithubPushResponse> PushAsync(
        GithubPushRequest request,
        string? sessionId,
        CancellationToken cancellationToken)
    {
        GithubRepositoryRules.ValidatePushRequest(request);
        if (!await rooms.ValidateRoomAccessAsync(request.RoomId, request.AccessKey))
            throw new GithubRepositoryException("The room invitation is invalid or expired.", 401);
        if (string.IsNullOrWhiteSpace(sessionId))
            throw new GithubRepositoryException("Sign in with GitHub before pushing changes.", 401);
        if (!await rateLimits.TryConsumeGithubRepositoryAsync(
                request.RoomId,
                sessionId,
                Guid.NewGuid().ToString("N")))
            throw new GithubRepositoryException("GitHub repository requests are temporarily limited for this room.", 429);

        var lockValue = Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(16));
        if (!await repositories.TryAcquirePushLockAsync(request.RoomId, lockValue))
            throw new GithubRepositoryException("Another GitHub push is in progress for this room.", 409);

        try
        {
            return await PushLockedAsync(request, sessionId, cancellationToken);
        }
        finally
        {
            await repositories.ReleasePushLockAsync(request.RoomId, lockValue);
        }
    }

    private async Task<GithubPushResponse> PushLockedAsync(
        GithubPushRequest request,
        string sessionId,
        CancellationToken cancellationToken)
    {
        var context = await LoadPushContextAsync(request, sessionId, cancellationToken);
        var treePlan = BuildTreePlan(request.Changes, context.Baseline);
        var tree = await CreateTreeAsync(context, request.Changes, treePlan, cancellationToken);
        var published = await CreateCommitAndBranchAsync(context, request.Message, tree.Sha, cancellationToken);
        var updatedBaseline = context.Baseline with
        {
            Branch = published.Branch,
            BaseCommitSha = published.CommitSha,
            BaseTreeSha = tree.Sha,
            FileBlobShas = treePlan.UpdatedShas,
            FileLineEndings = treePlan.UpdatedLineEndings
        };

        await repositories.SetAsync(request.RoomId, updatedBaseline);
        await events.SendToRoomAsync(
            request.RoomId,
            "GithubRepositoryBaseline",
            updatedBaseline,
            cancellationToken);

        var ownerRepo = $"{context.Baseline.Owner}/{context.Baseline.Name}";
        var branchPath = EncodeGitPath(published.Branch);
        var basePath = EncodeGitPath(context.Baseline.Branch);
        return new GithubPushResponse(
            updatedBaseline,
            $"https://github.com/{ownerRepo}/tree/{branchPath}",
            $"https://github.com/{ownerRepo}/compare/{basePath}...{branchPath}",
            published.CommitSha);
    }

    private async Task<GithubPushContext> LoadPushContextAsync(
        GithubPushRequest request,
        string sessionId,
        CancellationToken cancellationToken)
    {
        var baseline = await repositories.GetAsync(request.RoomId)
            ?? throw new GithubRepositoryException("This room is not connected to a GitHub repository.", 409);
        var (accessToken, scopes) = await oauth.GetAccessTokenAsync(sessionId, cancellationToken);
        if (!GithubOAuthService.HasRequiredRepositoryScope(scopes, baseline.IsPrivate))
            throw new GithubRepositoryException("Authorize GitHub repository access before pushing.", 403);

        var session = await oauth.GetSessionAsync(sessionId, cancellationToken);
        var repoPath = $"repos/{baseline.Owner}/{baseline.Name}";
        var current = await github.GetAsync<GithubCommitResponse>(
            $"{repoPath}/commits/{Uri.EscapeDataString(baseline.Branch)}",
            accessToken,
            cancellationToken);
        if (!string.Equals(current.Sha, baseline.BaseCommitSha, StringComparison.OrdinalIgnoreCase))
            throw new GithubRepositoryException(
                "The GitHub branch moved since this room opened it. Refresh the repository before pushing.",
                409);

        var entries = await treeState.GetEntriesAsync(request.RoomId);
        var knownPaths = entries.Values
            .Where(entry => !entry.IsFolder)
            .Select(entry => ProjectEntryPaths.GetPath(entry, entries))
            .Where(path => path is not null)
            .Select(path => path!)
            .ToHashSet(StringComparer.Ordinal);
        ValidateChanges(request.Changes, baseline, knownPaths);
        return new GithubPushContext(
            baseline,
            accessToken,
            session.Account.Id,
            session.Account.Login,
            repoPath);
    }

    private static void ValidateChanges(
        IReadOnlyList<GithubFileChange> changes,
        GithubRepositoryBaseline baseline,
        HashSet<string> knownPaths)
    {
        foreach (var change in changes)
        {
            if (change.Deleted)
            {
                if (change.Content is not null || !baseline.FileBlobShas.ContainsKey(change.Path) ||
                    knownPaths.Contains(change.Path))
                    throw new GithubRepositoryException("The change list does not match the room files.", 400);
            }
            else if (change.Content is null || !knownPaths.Contains(change.Path))
            {
                throw new GithubRepositoryException("The change list does not match the room files.", 400);
            }
        }
    }

    private static GithubTreePlan BuildTreePlan(
        IReadOnlyList<GithubFileChange> changes,
        GithubRepositoryBaseline baseline)
    {
        var treeItems = new List<object>();
        var updatedShas = new Dictionary<string, string>(baseline.FileBlobShas, StringComparer.Ordinal);
        var updatedLineEndings = new Dictionary<string, string>(baseline.FileLineEndings, StringComparer.Ordinal);
        foreach (var change in changes)
        {
            if (change.Deleted)
            {
                updatedShas.Remove(change.Path);
                updatedLineEndings.Remove(change.Path);
                treeItems.Add(new { path = change.Path, mode = "100644", type = "blob", sha = (string?)null });
                continue;
            }

            updatedLineEndings.TryAdd(change.Path, "lf");
            treeItems.Add(new { path = change.Path, mode = "100644", type = "blob", content = change.Content });
        }

        return new GithubTreePlan(treeItems, updatedShas, updatedLineEndings);
    }

    private async Task<GithubCreatedTreeResponse> CreateTreeAsync(
        GithubPushContext context,
        IReadOnlyList<GithubFileChange> changes,
        GithubTreePlan plan,
        CancellationToken cancellationToken)
    {
        var tree = await github.PostAsync<GithubCreatedTreeResponse>(
            $"{context.RepositoryPath}/git/trees",
            context.AccessToken,
            new { base_tree = context.Baseline.BaseTreeSha, tree = plan.Items },
            cancellationToken);
        if (!GithubRepositoryRules.IsSha(tree.Sha))
            throw new GithubRepositoryException("GitHub returned an invalid file revision.", 502);

        var createdFiles = tree.Tree.ToDictionary(item => item.Path, StringComparer.Ordinal);
        foreach (var change in changes.Where(change => !change.Deleted))
        {
            if (!createdFiles.TryGetValue(change.Path, out var file) || !GithubRepositoryRules.IsSha(file.Sha))
                throw new GithubRepositoryException("GitHub returned an invalid file revision.", 502);
            plan.UpdatedShas[change.Path] = file.Sha;
        }

        return tree;
    }

    private async Task<PublishedGithubCommit> CreateCommitAndBranchAsync(
        GithubPushContext context,
        string message,
        string treeSha,
        CancellationToken cancellationToken)
    {
        var commit = await github.PostAsync<GithubCommitCreatedResponse>(
            $"{context.RepositoryPath}/git/commits",
            context.AccessToken,
            new
            {
                message = message.Trim(),
                tree = treeSha,
                parents = new[] { context.Baseline.BaseCommitSha },
                author = new { name = context.AccountLogin, email = $"{context.AccountId}+{context.AccountLogin}@users.noreply.github.com" },
                committer = new { name = context.AccountLogin, email = $"{context.AccountId}+{context.AccountLogin}@users.noreply.github.com" }
            },
            cancellationToken);
        var branch = $"syncode/{DateTimeOffset.UtcNow:yyyyMMdd}-{Guid.NewGuid():N}"[..27];
        await github.PostAsync<GithubRefResponse>(
            $"{context.RepositoryPath}/git/refs",
            context.AccessToken,
            new { @ref = $"refs/heads/{branch}", sha = commit.Sha },
            cancellationToken);
        return new PublishedGithubCommit(branch, commit.Sha);
    }

    private static string EncodeGitPath(string path) =>
        string.Join('/', path.Split('/').Select(Uri.EscapeDataString));

    private sealed record GithubPushContext(
        GithubRepositoryBaseline Baseline,
        string AccessToken,
        long AccountId,
        string AccountLogin,
        string RepositoryPath);

    private sealed record GithubTreePlan(
        List<object> Items,
        Dictionary<string, string> UpdatedShas,
        Dictionary<string, string> UpdatedLineEndings);

    private sealed record PublishedGithubCommit(string Branch, string CommitSha);
}
