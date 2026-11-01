namespace server.Models;

public sealed record GithubOAuthExchangeRequest(
    string Code,
    string CodeVerifier,
    Uri RedirectUri);

public sealed record GithubAccountResponse(
    long Id,
    string Login,
    Uri AvatarUrl,
    bool CanPushPublicRepositories,
    bool CanPushPrivateRepositories);

public sealed record GithubSessionResponse(GithubAccountResponse Account);

public sealed record GithubOAuthSession(
    GithubAccountResponse Account,
    string SessionId,
    DateTimeOffset CookieExpiresAt);

public sealed class GithubOAuthException : Exception
{
    public GithubOAuthException() : base() { }

    public GithubOAuthException(string message)
        : this(message, false) { }

    public GithubOAuthException(string message, Exception innerException)
        : base(message, innerException) { }

    public GithubOAuthException(string message, bool unauthorized)
        : base(message) => Unauthorized = unauthorized;

    public bool Unauthorized { get; }
}
