using System.Text;
using System.Text.RegularExpressions;
using server.Application.Projects;
using server.Application.Rooms;
using server.Models;

namespace server.Services;

public sealed class GithubRepositoryCreateService(
    GithubApiClient github,
    GithubOAuthService oauth,
    IRoomInvitationStore rooms,
    IRoomRateLimiter rateLimits,
    GithubRepositoryStore repositories,
    RoomWorkspaceAdapter workspace,
    IRoomEventPublisher events)
{
    public async Task<GithubPushResponse> CreateAndPushAsync(
        GithubRepositoryCreateRequest request,
        string? sessionId,
        string adminConnectionId,
        CancellationToken cancellationToken)
    {
        ValidateRequest(request);
        if (!await rooms.ValidateRoomAccessAsync(request.RoomId, request.AccessKey))
            throw new GithubRepositoryException("The room invitation is invalid or expired.", 401);
        if (string.IsNullOrWhiteSpace(sessionId))
            throw new GithubRepositoryException("Sign in with GitHub before creating a repository.", 401);
        if (await repositories.GetAsync(request.RoomId) is not null)
            throw new GithubRepositoryException("This room already has a GitHub repository.", 409);
        if (!await rateLimits.TryConsumeGithubRepositoryAsync(
                request.RoomId, adminConnectionId, Guid.NewGuid().ToString("N")))
            throw new GithubRepositoryException("GitHub repository requests are temporarily limited for this room.", 429);

        var lockValue = Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(16));
        if (!await repositories.TryAcquirePushLockAsync(request.RoomId, lockValue))
            throw new GithubRepositoryException("Another GitHub operation is in progress for this room.", 409);

        string? createdRepositoryPath = null;
        string? accessToken = null;
        var repositoryInitialized = false;
        try
        {
            var (token, scopes) = await oauth.GetAccessTokenAsync(sessionId, cancellationToken);
            accessToken = token;
            if (!GithubOAuthService.HasRequiredRepositoryScope(scopes, request.IsPrivate))
                throw new GithubRepositoryException("Authorize GitHub repository access before creating a repository.", 403);

            var files = (await workspace.MaterializeAsync(request.RoomId))
                .Where(entry => !entry.IsFolder)
                .ToArray();
            ValidateWorkspace(files);

            var account = (await oauth.GetSessionAsync(sessionId, cancellationToken)).Account;
            var repository = await github.PostAsync<GithubApiRepository>(
                "user/repos",
                token,
                new { name = request.Name.Trim(), @private = request.IsPrivate, auto_init = false, default_branch = "main" },
                cancellationToken);
            if (!Regex.IsMatch(repository.Owner.Login, "^[A-Za-z0-9-]{1,39}$") ||
                !Regex.IsMatch(repository.Name, "^[A-Za-z0-9._-]{1,100}$"))
                throw new GithubRepositoryException("GitHub returned invalid repository information.", 502);
            createdRepositoryPath = $"repos/{repository.Owner.Login}/{repository.Name}";

            var tree = await github.PostAsync<GithubCreatedTreeResponse>(
                $"{createdRepositoryPath}/git/trees",
                token,
                new
                {
                    tree = files.Select(file => new
                    {
                        path = file.Path,
                        mode = "100644",
                        type = "blob",
                        content = file.Content
                    }).ToArray()
                },
                cancellationToken);
            if (!GithubRepositoryRules.IsSha(tree.Sha))
                throw new GithubRepositoryException("GitHub returned an invalid file revision.", 502);

            var blobs = tree.Tree.ToDictionary(file => file.Path, file => file.Sha, StringComparer.Ordinal);
            if (files.Any(file => !blobs.TryGetValue(file.Path, out var sha) || !GithubRepositoryRules.IsSha(sha)))
                throw new GithubRepositoryException("GitHub returned an incomplete file revision.", 502);

            var commit = await github.PostAsync<GithubCommitCreatedResponse>(
                $"{createdRepositoryPath}/git/commits",
                token,
                new
                {
                    message = request.Message.Trim(),
                    tree = tree.Sha,
                    parents = Array.Empty<string>(),
                    author = new
                    {
                        name = account.Login,
                        email = $"{account.Id}+{account.Login}@users.noreply.github.com"
                    },
                    committer = new
                    {
                        name = account.Login,
                        email = $"{account.Id}+{account.Login}@users.noreply.github.com"
                    }
                },
                cancellationToken);
            if (!GithubRepositoryRules.IsSha(commit.Sha))
                throw new GithubRepositoryException("GitHub returned an invalid commit revision.", 502);

            await github.PostAsync<GithubRefResponse>(
                $"{createdRepositoryPath}/git/refs",
                token,
                new { @ref = "refs/heads/main", sha = commit.Sha },
                cancellationToken);
            repositoryInitialized = true;

            var baseline = new GithubRepositoryBaseline(
                repository.Owner.Login,
                repository.Name,
                "main",
                commit.Sha,
                tree.Sha,
                request.IsPrivate,
                blobs)
            {
                FileLineEndings = files.ToDictionary(file => file.Path, _ => "lf", StringComparer.Ordinal)
            };
            await repositories.SetAsync(request.RoomId, baseline);
            await events.SendToRoomAsync(
                request.RoomId,
                "GithubRepositoryBaseline",
                baseline,
                cancellationToken);

            var ownerRepo = $"{repository.Owner.Login}/{repository.Name}";
            return new GithubPushResponse(
                baseline,
                $"https://github.com/{ownerRepo}/tree/main",
                $"https://github.com/{ownerRepo}/compare/main...main",
                commit.Sha);
        }
        catch
        {
            if (!repositoryInitialized && createdRepositoryPath is not null && accessToken is not null)
            {
                try
                {
                    await github.DeleteAsync(createdRepositoryPath, accessToken, cancellationToken);
                }
                catch
                {
                }
            }
            throw;
        }
        finally
        {
            await repositories.ReleasePushLockAsync(request.RoomId, lockValue);
        }
    }

    private static void ValidateRequest(GithubRepositoryCreateRequest request)
    {
        if (!GithubRepositoryRules.IsValidRoomId(request.RoomId) ||
            string.IsNullOrWhiteSpace(request.AccessKey) || request.AccessKey.Length > 256 ||
            !Regex.IsMatch(request.Name.Trim(), "^[A-Za-z0-9._-]{1,100}$") ||
            request.Name.Trim() is "." or ".." ||
            string.IsNullOrWhiteSpace(request.Message) || request.Message.Trim().Length > 200 ||
            request.Message.Any(char.IsControl))
            throw new GithubRepositoryException("The repository creation request is invalid.", 400);
    }

    private static void ValidateWorkspace(IReadOnlyList<RoomWorkspaceEntry> files)
    {
        if (files.Count is < 1 or > GithubRepositoryRules.MaxFiles)
            throw new GithubRepositoryException("The workspace must contain between 1 and 500 files.", 422);

        var paths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var totalBytes = 0;
        foreach (var file in files)
        {
            if (!ProjectPathRules.IsSafePath(file.Path) || !paths.Add(file.Path))
                throw new GithubRepositoryException("The workspace contains an invalid file path.", 422);
            var bytes = Encoding.UTF8.GetByteCount(file.Content);
            if (bytes > GithubRepositoryRules.MaxFileBytes)
                throw new GithubRepositoryException("A workspace file exceeds the 64 KB GitHub limit.", 413);
            totalBytes += bytes;
            if (totalBytes > GithubRepositoryRules.MaxProjectBytes)
                throw new GithubRepositoryException("The workspace exceeds the 1 MB GitHub limit.", 413);
        }
    }
}
