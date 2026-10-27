using System.Collections.Concurrent;
using System.Text;
using server.Application.Projects;
using server.Application.Rooms;
using server.Models;

namespace server.Services;

public sealed class GithubRepositoryImportService(
    GithubApiClient github,
    GithubOAuthService oauth,
    RedisRoomMetadataStore rooms,
    RedisRoomRateLimitStore rateLimits)
{
    private static readonly UTF8Encoding StrictUtf8 = new(false, true);

    public async Task<GithubRepositoryImportResponse> ImportAsync(
        GithubRepositoryImportRequest request,
        string? sessionId,
        string actorId,
        CancellationToken cancellationToken)
    {
        GithubRepositoryRules.ValidateRepositoryRequest(request);
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
        if (!GithubRepositoryRules.IsValidBranch(branch))
            throw new GithubRepositoryException("The repository branch is invalid.", 400);

        var branchCommit = await github.GetAsync<GithubCommitResponse>(
            $"{repositoryPath}/commits/{Uri.EscapeDataString(branch)}",
            accessToken,
            cancellationToken);
        if (!GithubRepositoryRules.IsSha(branchCommit.Sha) ||
            !GithubRepositoryRules.IsSha(branchCommit.Commit.Tree.Sha))
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
            if (reason is null && files.Count >= GithubRepositoryRules.MaxFiles)
                reason = "The 500-file import limit was reached";
            if (reason is null && totalBytes + entry.Size > GithubRepositoryRules.MaxProjectBytes)
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
        if (entry.Size is < 0 or > GithubRepositoryRules.MaxFileBytes)
            return "File exceeds the 64 KB per-file limit";
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
            Path.GetExtension(name).ToLowerInvariant() is ".pem" or ".key" or ".p12" or ".pfx" or
                ".crt" or ".cer" or ".der" or ".ppk" or ".keystore" or ".jks")
            return "File may contain a secret";
        if (Path.GetExtension(name).ToLowerInvariant() is ".7z" or ".avi" or ".bin" or ".bmp" or
            ".class" or ".dll" or ".doc" or ".docx" or ".eot" or ".exe" or ".gif" or ".gz" or
            ".ico" or ".jpeg" or ".jpg" or ".mp3" or ".mp4" or ".pdf" or ".png" or ".so" or
            ".tar" or ".ttf" or ".wasm" or ".webp" or ".woff" or ".woff2" or ".xls" or ".xlsx" or ".zip")
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
            blob.Size is < 0 or > GithubRepositoryRules.MaxFileBytes ||
            string.IsNullOrEmpty(blob.Content)) return null;
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
}
