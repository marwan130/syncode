namespace server.Services;

public static class ProductionConfigurationValidator
{
    public static void ValidateGithub(
        IConfiguration configuration,
        IHostEnvironment environment,
        IReadOnlyCollection<string> allowedOrigins)
    {
        if (environment.IsDevelopment()) return;

        Require(configuration, "Github:ClientId");
        Require(configuration, "Github:ClientSecret");

        var redirectValue = Require(configuration, "Github:RedirectUri");
        if (!Uri.TryCreate(redirectValue, UriKind.Absolute, out var redirectUri) ||
            redirectUri.Scheme != Uri.UriSchemeHttps ||
            redirectUri.AbsolutePath != "/github/callback" ||
            !string.IsNullOrEmpty(redirectUri.Query) ||
            !string.IsNullOrEmpty(redirectUri.Fragment) ||
            !string.IsNullOrEmpty(redirectUri.UserInfo))
            throw new InvalidOperationException(
                "Github:RedirectUri must be an HTTPS /github/callback URL without query or fragment data.");

        var callbackOrigin = redirectUri.GetLeftPart(UriPartial.Authority);
        if (!allowedOrigins.Contains(callbackOrigin, StringComparer.OrdinalIgnoreCase))
            throw new InvalidOperationException(
                "Github:RedirectUri must use an origin listed in AllowedOrigins.");

        var keyValue = Require(configuration, "Github:TokenEncryptionKey");
        try
        {
            if (Convert.FromBase64String(keyValue).Length != 32)
                throw new InvalidOperationException(
                    "Github:TokenEncryptionKey must be a base64-encoded 32-byte key.");
        }
        catch (FormatException exception)
        {
            throw new InvalidOperationException(
                "Github:TokenEncryptionKey must be a base64-encoded 32-byte key.", exception);
        }

        var allowedHosts = configuration["AllowedHosts"];
        if (string.IsNullOrWhiteSpace(allowedHosts) ||
            allowedHosts.Split(';', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
                .Any(host => host is "*" or "localhost" or "127.0.0.1" or "[::1]"))
            throw new InvalidOperationException(
                "Configure AllowedHosts with the production server host names before deployment.");
    }

    private static string Require(IConfiguration configuration, string key) =>
        !string.IsNullOrWhiteSpace(configuration[key])
            ? configuration[key]!.Trim()
            : throw new InvalidOperationException($"Configure {key} before starting Syncode outside Development.");
}
