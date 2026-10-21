namespace server.Services;

internal sealed record GithubVaultEntry(
    long GithubId,
    string Login,
    Uri? AvatarUrl,
    string AccessToken,
    string RefreshToken,
    DateTimeOffset AccessExpiresAt,
    DateTimeOffset RefreshExpiresAt);
