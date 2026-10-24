using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Text.Json.Serialization;
using server.Models;
using StackExchange.Redis;

namespace server.Services;

public sealed partial class GithubOAuthService(
    IHttpClientFactory clients,
    IConfiguration configuration,
    IConnectionMultiplexer redis,
    GithubTokenVault vault,
    ILogger<GithubOAuthService> logger)
{
    private const string GithubTokenEndpoint = "https://github.com/login/oauth/access_token";
    private const string GithubApiOrigin = "https://api.github.com";
    private const string GithubApiUserAgent = "Syncode/1.0";
    private const int RefreshMarginSeconds = 60;
    private readonly IDatabase _database = redis.GetDatabase();

    public async Task<GithubOAuthSession> ExchangeAsync(
        GithubOAuthExchangeRequest request,
        CancellationToken cancellationToken)
    {
        var clientId = RequiredSetting("Github:ClientId");
        var clientSecret = RequiredSetting("Github:ClientSecret");
        var redirectUri = RequiredSetting("Github:RedirectUri");
        if (!string.Equals(request.RedirectUri.OriginalString, redirectUri, StringComparison.Ordinal))
        {
            logger.LogWarning("GitHub OAuth callback validation failed.");
            throw new GithubOAuthException("GitHub sign-in could not be verified.");
        }

        var token = await RequestTokenAsync(new Dictionary<string, string>
        {
            ["client_id"] = clientId,
            ["client_secret"] = clientSecret,
            ["code"] = request.Code,
            ["redirect_uri"] = redirectUri,
            ["code_verifier"] = request.CodeVerifier
        }, cancellationToken);

        GithubAccountResponse account;
        IReadOnlyList<string> scopes;
        try
        {
            (account, scopes) = await FetchAccountAsync(token.AccessToken!, cancellationToken);
        }
        catch
        {
            await TryRevokeGrantAsync(token.AccessToken!, cancellationToken);
            throw;
        }
        var sessionId = GithubTokenVault.CreateSessionId();
        var now = DateTimeOffset.UtcNow;
        var avatarUrl = account.AvatarUrl.IsAbsoluteUri ? account.AvatarUrl : null;
        var entry = new GithubVaultEntry(
            account.Id,
            account.Login,
            avatarUrl,
            token.AccessToken!,
            token.RefreshToken!,
            now.AddSeconds(token.ExpiresIn),
            now.AddSeconds(token.RefreshTokenExpiresIn),
            MergeScopes(scopes, token.Scope));
        try
        {
            await vault.SetAsync(sessionId, entry);
        }
        catch
        {
            await TryRevokeGrantAsync(token.AccessToken!, cancellationToken);
            throw;
        }
        return new GithubOAuthSession(account, sessionId, entry.RefreshExpiresAt);
    }

    public async Task<GithubOAuthSession> GetSessionAsync(
        string sessionId,
        CancellationToken cancellationToken)
    {
        if (!IsValidSessionId(sessionId))
            throw new GithubOAuthException("GitHub sign-in has expired.", true);
        var entry = await vault.GetAsync(sessionId);
        if (entry is null)
            throw new GithubOAuthException("GitHub sign-in has expired.", true);
        if (entry.RefreshExpiresAt <= DateTimeOffset.UtcNow)
        {
            await vault.DeleteAsync(sessionId);
            throw new GithubOAuthException("GitHub sign-in has expired.", true);
        }
        if (entry.AccessExpiresAt <= DateTimeOffset.UtcNow.AddSeconds(RefreshMarginSeconds))
            entry = await RefreshSessionAsync(sessionId, cancellationToken);

        return new GithubOAuthSession(ToAccount(entry), sessionId, entry.RefreshExpiresAt);
    }

    public async Task<(string AccessToken, IReadOnlyList<string> Scopes)> GetAccessTokenAsync(
        string sessionId,
        CancellationToken cancellationToken)
    {
        await GetSessionAsync(sessionId, cancellationToken);
        var entry = await vault.GetAsync(sessionId);
        if (entry is null)
            throw new GithubOAuthException("GitHub sign-in has expired.", true);
        return (entry.AccessToken, entry.Scopes ?? []);
    }

    public async Task<bool> RevokeSessionAsync(
        string sessionId,
        CancellationToken cancellationToken)
    {
        if (!IsValidSessionId(sessionId)) return true;
        GithubVaultEntry? entry;
        try
        {
            entry = await vault.GetAsync(sessionId);
        }
        catch (GithubOAuthException)
        {
            await vault.DeleteAsync(sessionId);
            return false;
        }
        await vault.DeleteAsync(sessionId);
        if (entry is null) return true;

        return await TryRevokeGrantAsync(entry.AccessToken, cancellationToken);
    }

    private async Task<bool> TryRevokeGrantAsync(
        string accessToken,
        CancellationToken cancellationToken)
    {
        var clientId = RequiredSetting("Github:ClientId");
        var clientSecret = RequiredSetting("Github:ClientSecret");
        var credentials = Convert.ToBase64String(
            Encoding.UTF8.GetBytes($"{clientId}:{clientSecret}"));
        using var request = new HttpRequestMessage(
            HttpMethod.Delete,
            $"{GithubApiOrigin}/applications/{Uri.EscapeDataString(clientId)}/grant");
        request.Headers.Authorization = new AuthenticationHeaderValue("Basic", credentials);
        request.Headers.UserAgent.ParseAdd(GithubApiUserAgent);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));
        request.Headers.Add("X-GitHub-Api-Version", "2022-11-28");
        request.Content = JsonContent.Create(new { access_token = accessToken });

        try
        {
            using var response = await clients.CreateClient("GithubOAuth").SendAsync(request, cancellationToken);
            return response.StatusCode == HttpStatusCode.NoContent;
        }
        catch (Exception exception) when (
            exception is HttpRequestException or TaskCanceledException)
        {
            return false;
        }
    }

    private async Task<GithubVaultEntry> RefreshSessionAsync(
        string sessionId,
        CancellationToken cancellationToken)
    {
        var key = GithubTokenVault.GetSessionKey(sessionId);
        var lockKey = $"{key}:refresh-lock";
        var lockValue = Convert.ToHexString(RandomNumberGenerator.GetBytes(16));
        var acquired = await _database.StringSetAsync(
            lockKey,
            lockValue,
            TimeSpan.FromSeconds(20),
            When.NotExists);

        if (!acquired)
        {
            for (var attempt = 0; attempt < 60; attempt++)
            {
                await Task.Delay(200, cancellationToken);
                var refreshed = await vault.GetAsync(sessionId);
                if (refreshed is null)
                    throw new GithubOAuthException("GitHub sign-in has expired.", true);
                if (refreshed.AccessExpiresAt > DateTimeOffset.UtcNow.AddSeconds(RefreshMarginSeconds))
                    return refreshed;
            }
            throw new GithubOAuthException("GitHub sign-in is busy. Try again shortly.");
        }

        try
        {
            var latest = await vault.GetAsync(sessionId);
            if (latest is null)
                throw new GithubOAuthException("GitHub sign-in has expired.", true);
            if (latest.AccessExpiresAt > DateTimeOffset.UtcNow.AddSeconds(RefreshMarginSeconds))
                return latest;

            GithubTokenResponse token;
            try
            {
                token = await RequestTokenAsync(new Dictionary<string, string>
                {
                    ["client_id"] = RequiredSetting("Github:ClientId"),
                    ["client_secret"] = RequiredSetting("Github:ClientSecret"),
                    ["grant_type"] = "refresh_token",
                    ["refresh_token"] = latest.RefreshToken
                }, cancellationToken);
            }
            catch (GithubOAuthException exception) when (exception.Unauthorized)
            {
                await vault.DeleteAsync(sessionId);
                throw;
            }

            var now = DateTimeOffset.UtcNow;
            var updated = latest with
            {
                AccessToken = token.AccessToken,
                RefreshToken = token.RefreshToken,
                AccessExpiresAt = now.AddSeconds(token.ExpiresIn),
                RefreshExpiresAt = now.AddSeconds(token.RefreshTokenExpiresIn)
            };
            await vault.SetAsync(sessionId, updated);
            return updated;
        }
        finally
        {
            const string releaseLockScript =
                "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
            await _database.ScriptEvaluateAsync(
                releaseLockScript,
                [lockKey],
                [lockValue]);
        }
    }

    private async Task<GithubTokenResponse> RequestTokenAsync(
        Dictionary<string, string> values,
        CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, GithubTokenEndpoint)
        {
            Content = new FormUrlEncodedContent(values)
        };
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        using var response = await clients.CreateClient("GithubOAuth").SendAsync(request, cancellationToken);
        var token = await response.Content.ReadFromJsonAsync<GithubTokenResponse>(cancellationToken);
        if (token?.Error is "bad_refresh_token" or "invalid_grant")
            throw new GithubOAuthException("GitHub sign-in has expired.", true);
        if (!response.IsSuccessStatusCode || !IsValidToken(token))
        {
            logger.LogWarning(
                "GitHub token exchange failed with HTTP status {StatusCode}.",
                (int)response.StatusCode);
            throw new GithubOAuthException("GitHub sign-in could not be completed.");
        }
        return token!;
    }

    private async Task<(GithubAccountResponse Account, IReadOnlyList<string> Scopes)> FetchAccountAsync(
        string accessToken,
        CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, $"{GithubApiOrigin}/user");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        request.Headers.UserAgent.ParseAdd(GithubApiUserAgent);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));
        request.Headers.Add("X-GitHub-Api-Version", "2022-11-28");
        using var response = await clients.CreateClient("GithubOAuth").SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            logger.LogWarning(
                "GitHub account verification failed with HTTP status {StatusCode}.",
                (int)response.StatusCode);
            throw new GithubOAuthException("Could not verify the GitHub account.");
        }
        var user = await response.Content.ReadFromJsonAsync<GithubUserResponse>(cancellationToken);
        if (user is null || user.Id <= 0 ||
            !GithubLoginPattern().IsMatch(user.Login ?? ""))
            throw new GithubOAuthException("GitHub returned an invalid account profile.");

        var avatarUrl = user.AvatarUrl is { IsAbsoluteUri: true } avatar &&
            avatar.Scheme == Uri.UriSchemeHttps && avatar.Host == "avatars.githubusercontent.com"
                ? avatar
                : null;
        var scopes = response.Headers.TryGetValues("X-OAuth-Scopes", out var values)
            ? values.SelectMany(value => value.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
                .Distinct(StringComparer.OrdinalIgnoreCase).ToArray()
            : [];
        var account = new GithubAccountResponse(
            user.Id,
            user.Login!,
            avatarUrl ?? new Uri("", UriKind.Relative),
            HasScope(scopes, "public_repo") || HasScope(scopes, "repo"),
            HasScope(scopes, "repo"));
        return (account, scopes);
    }

    private static GithubAccountResponse ToAccount(GithubVaultEntry entry) =>
        new(
            entry.GithubId,
            entry.Login,
            entry.AvatarUrl ?? new Uri("", UriKind.Relative),
            HasScope(entry.Scopes, "public_repo") || HasScope(entry.Scopes, "repo"),
            HasScope(entry.Scopes, "repo"));

    private static IReadOnlyList<string> MergeScopes(
        IReadOnlyList<string> accountScopes,
        string? tokenScopes) => accountScopes
        .Concat((tokenScopes ?? "").Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
            .Distinct(StringComparer.OrdinalIgnoreCase)
        .ToArray();

    private static bool HasScope(IReadOnlyList<string>? scopes, string scope) =>
        scopes?.Contains(scope, StringComparer.OrdinalIgnoreCase) == true;

    public static bool HasRequiredRepositoryScope(
        IReadOnlyList<string> scopes,
        bool isPrivate) => isPrivate
        ? HasScope(scopes, "repo")
        : HasScope(scopes, "public_repo") || HasScope(scopes, "repo");

    private static bool IsValidSessionId(string sessionId) =>
        sessionId.Length == 43 && sessionId.All(character =>
            char.IsAsciiLetterOrDigit(character) || character is '-' or '_');

    private string RequiredSetting(string key) =>
        configuration[key] is { Length: > 0 } value
            ? value
            : throw new GithubOAuthException("GitHub sign-in is not configured.");

    private static bool IsValidToken(GithubTokenResponse? token) =>
        token is not null &&
        token.AccessToken is { Length: >= 20 and <= 512 } access &&
        GithubAccessTokenPattern().IsMatch(access) &&
        token.RefreshToken is { Length: >= 20 and <= 512 } refresh &&
        GithubRefreshTokenPattern().IsMatch(refresh) &&
        token.ExpiresIn is > 0 and <= 28800 &&
        token.RefreshTokenExpiresIn is > 0 and <= 15897600 &&
        string.Equals(token.TokenType, "bearer", StringComparison.OrdinalIgnoreCase);

    private sealed class GithubTokenResponse
    {
        [JsonPropertyName("access_token")]
        public string AccessToken { get; init; } = "";

        [JsonPropertyName("refresh_token")]
        public string RefreshToken { get; init; } = "";

        [JsonPropertyName("expires_in")]
        public int ExpiresIn { get; init; }

        [JsonPropertyName("refresh_token_expires_in")]
        public int RefreshTokenExpiresIn { get; init; }

        [JsonPropertyName("token_type")]
        public string TokenType { get; init; } = "";

        [JsonPropertyName("scope")]
        public string? Scope { get; init; }

        [JsonPropertyName("error")]
        public string? Error { get; init; }
    }

    private sealed class GithubUserResponse
    {
        public long Id { get; init; }
        public string? Login { get; init; }

        [JsonPropertyName("avatar_url")]
        public Uri? AvatarUrl { get; init; }
    }

    [GeneratedRegex("^[A-Za-z0-9-]{1,39}$", RegexOptions.CultureInvariant)]
    private static partial Regex GithubLoginPattern();

    [GeneratedRegex("^[A-Za-z0-9_]+$", RegexOptions.CultureInvariant)]
    private static partial Regex GithubAccessTokenPattern();

    [GeneratedRegex("^ghr_[A-Za-z0-9_]{16,508}$", RegexOptions.CultureInvariant)]
    private static partial Regex GithubRefreshTokenPattern();
}
