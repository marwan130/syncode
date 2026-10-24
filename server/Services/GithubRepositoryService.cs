using System.Collections.Concurrent;
using System.Text;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using server.Models;

namespace server.Services;

public sealed class GithubRepositoryService(
    GithubApiClient github,
    GithubOAuthService oauth,
    RedisRoomMetadataStore rooms,
    RedisRoomRateLimitStore rateLimits,
    GithubRepositoryStore repositories,
    ProjectTreeStateService treeState,
    IRoomEventPublisher events)
{
    private const int MaxFiles = 500;
    private const int MaxFileBytes = 64 * 1024;
    private const int MaxProjectBytes = 1024 * 1024;
    private static readonly UTF8Encoding StrictUtf8 = new(false, true);

    public async Task<GithubRepositoryImportResponse> ImportAsync(
        GithubRepositoryImportRequest request,
        string? sessionId,
        string actorId,
        CancellationToken cancellationToken)
    {
        ValidateRepositoryRequest(request);
        if (!await rooms.ValidateRoomAccessAsync(request.RoomId, request.AccessKey))
            throw new GithubRepositoryException("The room invitation is invalid or expired.", 401);
        if (!await rateLimits.TryConsumeGithubRepositoryAsync(
                request.RoomId,
                actorId,
                Guid.NewGuid().ToString("N")))
            throw new GithubRepositoryException("GitHub repository requests are temporarily limited for this room.", 429);

        var (accessToken, scopes) = await GetOptionalAccessTokenAsync(sessionId, cancellationToken);
        var repositoryPath = $"repos/{request.Owner}/{request.Name}";
        var repository = await GetRepositoryAsync(repositoryPath, accessToken, scopes, cancellationToken);
        var branch = string.IsNullOrWhiteSpace(request.Branch)
            ? repository.DefaultBranch
            : request.Branch.Trim();
        if (!IsValidBranch(branch))
            throw new GithubRepositoryException("The repository branch is invalid.", 400);

        var branchCommit = await github.GetAsync<GithubCommitResponse>(
            $"{repositoryPath}/commits/{Uri.EscapeDataString(branch)}",
            accessToken,
            cancellationToken);
        if (!IsSha(branchCommit.Sha) || !IsSha(branchCommit.Commit.Tree.Sha))
            throw new GithubRepositoryException("GitHub returned an invalid repository revision.", 502);

        var tree = await github.GetAsync<GithubTreeResponse>(
            $"{repositoryPath}/git/trees/{branchCommit.Commit.Tree.Sha}?recursive=1",
            accessToken,
            cancellationToken);
        if (tree.Truncated || tree.Entries.Count > 10000)
            throw new GithubRepositoryException(
                "This repository tree is too large to open in Syncode.", 413);

        var skipped = new ConcurrentBag<GithubSkippedFile>();
        var candidates = SelectImportCandidates(tree.Entries, skipped);
        var files = new ConcurrentBag<GithubRepositoryFile>();
        using var concurrency = new SemaphoreSlim(6, 6);
        await Task.WhenAll(candidates.Select(async entry =>
        {
            await concurrency.WaitAsync(cancellationToken);
            try
            {
                var blob = await github.GetAsync<GithubBlobResponse>(
                    $"{repositoryPath}/git/blobs/{entry.Sha}",
                    accessToken,
                    cancellationToken);
                var file = DecodeBlob(entry.Path, entry.Sha, blob);
                if (file is not null) files.Add(file);
                else skipped.Add(new GithubSkippedFile(entry.Path, "Binary or invalid UTF-8 file"));
            }
            catch (GithubRepositoryException exception) when (
                exception.StatusCode is 413 or 502)
            {
                skipped.Add(new GithubSkippedFile(entry.Path, "Could not safely read this file"));
            }
            finally
            {
                concurrency.Release();
            }
        }));

        var orderedFiles = files.OrderBy(file => file.Path, StringComparer.Ordinal).ToArray();
        if (orderedFiles.Length == 0)
            throw new GithubRepositoryException("No supported text files were found in this repository.", 422);

        var baseline = new GithubRepositoryBaseline(
            request.Owner,
            request.Name,
            branch,
            branchCommit.Sha,
            branchCommit.Commit.Tree.Sha,
            repository.IsPrivate,
            orderedFiles.ToDictionary(file => file.Path, file => file.BlobSha, StringComparer.Ordinal))
        {
            FileLineEndings = orderedFiles.ToDictionary(
                file => file.Path,
                file => GetLineEnding(file.Content),
                StringComparer.Ordinal)
        };
        return new GithubRepositoryImportResponse(
            baseline,
            orderedFiles,
            skipped.OrderBy(file => file.Path, StringComparer.Ordinal).ToArray());
    }

    public async Task<GithubPushResponse> PushAsync(
        GithubPushRequest request,
        string? sessionId,
        CancellationToken cancellationToken)
    {
        ValidatePushRequest(request);
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
            var baseline = await repositories.GetAsync(request.RoomId)
                ?? throw new GithubRepositoryException("This room is not connected to a GitHub repository.", 409);
            var (accessToken, scopes) = await oauth.GetAccessTokenAsync(sessionId, cancellationToken);
            if (!GithubOAuthService.HasRequiredRepositoryScope(scopes, baseline.IsPrivate))
                throw new GithubRepositoryException("Authorize GitHub repository access before pushing.", 403);

            var participant = await oauth.GetSessionAsync(sessionId, cancellationToken);
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
            var pathsById = entries.Values
                .Where(entry => !entry.IsFolder)
                .Select(entry => (Entry: entry, Path: ProjectTreeStateService.GetEntryPath(entry, entries)))
                .Where(item => item.Path is not null)
                .ToDictionary(item => item.Entry.Id, item => item.Path!, StringComparer.Ordinal);
            var knownPaths = pathsById.Values.ToHashSet(StringComparer.Ordinal);
            foreach (var change in request.Changes)
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

            var treeItems = new List<object>();
            var updatedShas = new Dictionary<string, string>(baseline.FileBlobShas, StringComparer.Ordinal);
            var updatedLineEndings = new Dictionary<string, string>(baseline.FileLineEndings, StringComparer.Ordinal);
            foreach (var change in request.Changes)
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

            var newTree = await github.PostAsync<GithubCreatedTreeResponse>(
                $"{repoPath}/git/trees",
                accessToken,
                new { base_tree = baseline.BaseTreeSha, tree = treeItems },
                cancellationToken);
            if (!IsSha(newTree.Sha))
                throw new GithubRepositoryException("GitHub returned an invalid file revision.", 502);
            var createdFiles = newTree.Tree.ToDictionary(item => item.Path, StringComparer.Ordinal);
            foreach (var change in request.Changes.Where(change => !change.Deleted))
            {
                if (!createdFiles.TryGetValue(change.Path, out var file) || !IsSha(file.Sha))
                    throw new GithubRepositoryException("GitHub returned an invalid file revision.", 502);
                updatedShas[change.Path] = file.Sha;
            }
            var commit = await github.PostAsync<GithubCommitCreatedResponse>(
                $"{repoPath}/git/commits",
                accessToken,
                new
                {
                    message = request.Message.Trim(),
                    tree = newTree.Sha,
                    parents = new[] { baseline.BaseCommitSha },
                    author = new { name = participant.Account.Login, email = $"{participant.Account.Id}+{participant.Account.Login}@users.noreply.github.com" },
                    committer = new { name = participant.Account.Login, email = $"{participant.Account.Id}+{participant.Account.Login}@users.noreply.github.com" }
                },
                cancellationToken);
            var branch = $"syncode/{DateTimeOffset.UtcNow:yyyyMMdd}-{Guid.NewGuid():N}"[..27];
            await github.PostAsync<GithubRefResponse>(
                $"{repoPath}/git/refs",
                accessToken,
                new { @ref = $"refs/heads/{branch}", sha = commit.Sha },
                cancellationToken);

            var updatedBaseline = baseline with
            {
                Branch = branch,
                BaseCommitSha = commit.Sha,
                BaseTreeSha = newTree.Sha,
                FileBlobShas = updatedShas,
                FileLineEndings = updatedLineEndings
            };
            await repositories.SetAsync(request.RoomId, updatedBaseline);
            await events.SendToRoomAsync(
                request.RoomId,
                "GithubRepositoryBaseline",
                updatedBaseline,
                cancellationToken);

            var ownerRepo = $"{baseline.Owner}/{baseline.Name}";
            var branchPath = string.Join('/', branch.Split('/').Select(Uri.EscapeDataString));
            var basePath = string.Join('/', baseline.Branch.Split('/').Select(Uri.EscapeDataString));
            return new GithubPushResponse(
                updatedBaseline,
                $"https://github.com/{ownerRepo}/tree/{branchPath}",
                $"https://github.com/{ownerRepo}/compare/{basePath}...{branchPath}",
                commit.Sha);
        }
        finally
        {
            await repositories.ReleasePushLockAsync(request.RoomId, lockValue);
        }
    }

    private async Task<GithubApiRepository> GetRepositoryAsync(
        string path,
        string? accessToken,
        IReadOnlyList<string> scopes,
        CancellationToken cancellationToken)
    {
        try
        {
            return await github.GetAsync<GithubApiRepository>(path, accessToken, cancellationToken);
        }
        catch (GithubRepositoryException exception) when (
            exception.StatusCode == 404 && !string.IsNullOrWhiteSpace(accessToken) &&
            !GithubOAuthService.HasRequiredRepositoryScope(scopes, true))
        {
            throw new GithubRepositoryException("Authorize private repository access, then try again.", 403);
        }
    }

    private async Task<(string? AccessToken, IReadOnlyList<string> Scopes)> GetOptionalAccessTokenAsync(
        string? sessionId,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(sessionId)) return (null, []);
        var session = await oauth.GetAccessTokenAsync(sessionId, cancellationToken);
        return session;
    }

    private static IReadOnlyList<GithubTreeEntry> SelectImportCandidates(
        IReadOnlyList<GithubTreeEntry> entries,
        ConcurrentBag<GithubSkippedFile> skipped)
    {
        var files = new List<GithubTreeEntry>();
        var totalBytes = 0L;
        foreach (var entry in entries.Where(entry => entry.Type == "blob"))
        {
            var reason = GetSkipReason(entry);
            if (reason is null && files.Count >= MaxFiles) reason = "The 500-file import limit was reached";
            if (reason is null && totalBytes + entry.Size > MaxProjectBytes)
                reason = "The 1 MB total import limit was reached";
            if (reason is not null)
            {
                skipped.Add(new GithubSkippedFile(entry.Path, reason));
                continue;
            }
            totalBytes += entry.Size;
            files.Add(entry);
        }
        return files;
    }

    private static string? GetSkipReason(GithubTreeEntry entry)
    {
        if (!ProjectPathRules.IsSafePath(entry.Path)) return "Unsafe file path";
        if (entry.Mode is not ("100644" or "100755")) return "Unsupported file type";
        if (entry.Size is < 0 or > MaxFileBytes) return "File exceeds the 64 KB per-file limit";
        var segments = entry.Path.Split('/');
        var ignoredDirectories = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            ".git", "node_modules", "bower_components", ".next", ".nuxt", ".vite",
            "build", "dist", "out", "target", "bin", "obj", "coverage"
        };
        if (segments.Any(ignoredDirectories.Contains)) return "Generated or dependency folder";
        var name = segments[^1];
        if (name.StartsWith(".env", StringComparison.OrdinalIgnoreCase) ||
            name.StartsWith("id_rsa", StringComparison.OrdinalIgnoreCase) ||
            name.StartsWith("id_ed25519", StringComparison.OrdinalIgnoreCase) ||
            name.Equals(".npmrc", StringComparison.OrdinalIgnoreCase) ||
            name.Equals(".pypirc", StringComparison.OrdinalIgnoreCase) ||
            Path.GetExtension(name).ToLowerInvariant() is ".pem" or ".key" or ".p12" or ".pfx" or ".crt" or ".cer" or ".der" or ".ppk" or ".keystore" or ".jks")
            return "File may contain a secret";
        if (Path.GetExtension(name).ToLowerInvariant() is ".7z" or ".avi" or ".bin" or ".bmp" or ".class" or ".dll" or ".doc" or ".docx" or ".eot" or ".exe" or ".gif" or ".gz" or ".ico" or ".jpeg" or ".jpg" or ".mp3" or ".mp4" or ".pdf" or ".png" or ".so" or ".tar" or ".ttf" or ".wasm" or ".webp" or ".woff" or ".woff2" or ".xls" or ".xlsx" or ".zip")
            return "Binary file";
        return null;
    }

    private static string GetLineEnding(string content) =>
        content.Contains("\r\n", StringComparison.Ordinal)
            ? "crlf"
            : content.Contains('\r') ? "cr" : "lf";

    private static GithubRepositoryFile? DecodeBlob(
        string path,
        string sha,
        GithubBlobResponse blob)
    {
        if (!string.Equals(blob.Encoding, "base64", StringComparison.OrdinalIgnoreCase) ||
            blob.Size is < 0 or > MaxFileBytes || string.IsNullOrEmpty(blob.Content)) return null;
        try
        {
            var bytes = Convert.FromBase64String(blob.Content);
            if (bytes.Length != blob.Size || bytes.Contains((byte)0)) return null;
            var content = StrictUtf8.GetString(bytes);
            return new GithubRepositoryFile(path, content, sha, bytes.Length);
        }
        catch (FormatException)
        {
            return null;
        }
        catch (DecoderFallbackException)
        {
            return null;
        }
    }

    private static void ValidateRepositoryRequest(GithubRepositoryImportRequest request)
    {
        if (!IsValidRoomId(request.RoomId) || string.IsNullOrWhiteSpace(request.AccessKey) ||
            !Regex.IsMatch(request.Owner, "^[A-Za-z0-9-]{1,39}$") ||
            !Regex.IsMatch(request.Name, "^[A-Za-z0-9._-]{1,100}$") ||
            request.Name is "." or ".." ||
            request.Branch?.Length > 255)
            throw new GithubRepositoryException("The repository request is invalid.", 400);
    }

    private static void ValidatePushRequest(GithubPushRequest request)
    {
        if (!IsValidRoomId(request.RoomId) || string.IsNullOrWhiteSpace(request.AccessKey) ||
            string.IsNullOrWhiteSpace(request.Message) || request.Message.Trim().Length > 200 ||
            request.Message.Any(char.IsControl) || request.Changes is null ||
            request.Changes.Count is < 1 or > MaxFiles)
            throw new GithubRepositoryException("The GitHub push request is invalid.", 400);

        var paths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var totalBytes = 0;
        foreach (var change in request.Changes)
        {
            if (!ProjectPathRules.IsSafePath(change.Path) || !paths.Add(change.Path) ||
                change.Deleted == (change.Content is not null))
                throw new GithubRepositoryException("The GitHub push request is invalid.", 400);
            if (change.Content is null) continue;
            var bytes = Encoding.UTF8.GetByteCount(change.Content);
            if (bytes > MaxFileBytes || change.Content.Contains('\0'))
                throw new GithubRepositoryException("A changed file exceeds the 64 KB limit.", 413);
            totalBytes += bytes;
            if (totalBytes > MaxProjectBytes)
                throw new GithubRepositoryException("The changes exceed the 1 MB push limit.", 413);
        }
    }

    private static bool IsValidBranch(string? branch) =>
        !string.IsNullOrWhiteSpace(branch) && branch.Length <= 255 &&
        !branch.StartsWith('/') && !branch.EndsWith('/') &&
        !branch.Contains("..", StringComparison.Ordinal) &&
        !branch.Contains("@{", StringComparison.Ordinal) &&
        !branch.Any(character => char.IsControl(character) || character is ' ' or '~' or '^' or ':' or '?' or '*' or '[' or '\\');

    private static bool IsSha(string? value) =>
        value is not null && Regex.IsMatch(value, "^[a-fA-F0-9]{40}$");

    private static bool IsValidRoomId(string? roomId) =>
        roomId is { Length: 8 } && roomId.All(character =>
            character is >= 'a' and <= 'z' or >= '0' and <= '9');

    private sealed class GithubApiRepository
    {
        [JsonPropertyName("default_branch")]
        public string DefaultBranch { get; init; } = "";
        [JsonPropertyName("private")]
        public bool IsPrivate { get; init; }
    }

    private sealed class GithubCommitResponse
    {
        public string Sha { get; init; } = "";
        public GithubCommitData Commit { get; init; } = new();
    }

    private sealed class GithubCommitData
    {
        public GithubTreeReference Tree { get; init; } = new();
    }

    private sealed class GithubTreeReference
    {
        public string Sha { get; init; } = "";
    }

    private sealed class GithubTreeResponse
    {
        public bool Truncated { get; init; }
        [JsonPropertyName("tree")]
        public List<GithubTreeEntry> Entries { get; init; } = [];
    }

    private sealed class GithubTreeEntry
    {
        public string Path { get; init; } = "";
        public string Type { get; init; } = "";
        public string Mode { get; init; } = "";
        public string Sha { get; init; } = "";
        public long Size { get; init; }
    }

    private sealed class GithubBlobResponse
    {
        public string Encoding { get; init; } = "";
        public string Content { get; init; } = "";
        public long Size { get; init; }
    }

    private sealed class GithubShaResponse
    {
        public string Sha { get; init; } = "";
    }

    private sealed class GithubCreatedTreeResponse
    {
        public string Sha { get; init; } = "";
        public List<GithubCreatedTreeEntry> Tree { get; init; } = [];
    }

    private sealed class GithubCreatedTreeEntry
    {
        public string Path { get; init; } = "";
        public string Sha { get; init; } = "";
    }

    private sealed class GithubCommitCreatedResponse
    {
        public string Sha { get; init; } = "";
    }

    private sealed class GithubRefResponse { }
}
