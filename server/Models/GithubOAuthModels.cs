namespace server.Models;

public sealed record GithubOAuthExchangeRequest(
    string Code,
    string CodeVerifier,
    Uri RedirectUri);

public sealed record GithubAccountResponse(
    long Id,
    string Login,
    Uri AvatarUrl);

public sealed record GithubSessionResponse(GithubAccountResponse Account);

public sealed record GithubOAuthSession(
    GithubAccountResponse Account,
    string SessionId,
    DateTimeOffset CookieExpiresAt);

public sealed class GithubOAuthException : Exception
{
    public GithubOAuthException(string message, bool unauthorized = false)
        : base(message) => Unauthorized = unauthorized;

    public bool Unauthorized { get; }
}
