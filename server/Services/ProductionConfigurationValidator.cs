using System.Net;
using System.Text;

namespace server.Services;

public static class ProductionConfigurationValidator
{
    public static void ValidateGithub(
        IConfiguration configuration,
        IHostEnvironment environment,
        IReadOnlyCollection<string> allowedOrigins)
    {
        if (environment.IsDevelopment()) return;

        if (allowedOrigins.Count == 0 || allowedOrigins.Any(origin =>
                !Uri.TryCreate(origin, UriKind.Absolute, out var uri) ||
                uri.Scheme != Uri.UriSchemeHttps ||
                uri.AbsolutePath != "/" ||
                !string.IsNullOrEmpty(uri.Query) ||
                !string.IsNullOrEmpty(uri.Fragment) ||
                !string.IsNullOrEmpty(uri.UserInfo)))
            throw new InvalidOperationException("Production AllowedOrigins entries must be HTTPS origins without paths or credentials.");

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

        var allowedHosts = configuration["AllowedHosts"]?
            .Split(';', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries) ?? [];
        if (allowedHosts.Length == 0 || allowedHosts.Any(host =>
                host.Contains('*') ||
                !Uri.TryCreate($"http://{host}", UriKind.Absolute, out var uri) ||
                uri.Host.Equals("localhost", StringComparison.OrdinalIgnoreCase) ||
                IPAddress.TryParse(uri.Host.Trim('[', ']'), out var address) && IPAddress.IsLoopback(address)))
            throw new InvalidOperationException(
                "Configure AllowedHosts with the production server host names before deployment.");
    }

    public static void ValidateExecutionService(IConfiguration configuration, IHostEnvironment environment)
    {
        if (environment.IsDevelopment()) return;

        var value = Require(configuration, "ExecutionService:BaseUrl");
        if (!Uri.TryCreate(value, UriKind.Absolute, out var serviceUri) ||
            serviceUri.Scheme != Uri.UriSchemeHttp && serviceUri.Scheme != Uri.UriSchemeHttps ||
            !string.IsNullOrEmpty(serviceUri.UserInfo) ||
            !string.IsNullOrEmpty(serviceUri.Query) ||
            !string.IsNullOrEmpty(serviceUri.Fragment))
            throw new InvalidOperationException(
                "ExecutionService:BaseUrl must be an HTTP or HTTPS URL without credentials, query, or fragment data.");

        if (serviceUri.Scheme == Uri.UriSchemeHttp &&
            (!IPAddress.TryParse(serviceUri.Host.Trim('[', ']'), out var address) || !IsPrivateAddress(address)))
            throw new InvalidOperationException(
                "ExecutionService:BaseUrl must use HTTPS unless it targets a private IP address on the internal network.");

        var apiKey = Require(configuration, "ExecutionService:ApiKey");
        if (Encoding.UTF8.GetByteCount(apiKey) < 32)
            throw new InvalidOperationException("ExecutionService:ApiKey must contain at least 32 bytes.");
    }

    public static void ValidateRedisConnection(string connection, IHostEnvironment environment)
    {
        if (environment.IsDevelopment()) return;

        try
        {
            var password = StackExchange.Redis.ConfigurationOptions.Parse(connection).Password;
            if (password is null)
                throw new InvalidOperationException("Configure Redis authentication before starting Syncode outside Development.");
            if (Encoding.UTF8.GetByteCount(password) < 32)
                throw new InvalidOperationException("The Redis password must contain at least 32 bytes outside Development.");
        }
        catch (FormatException exception)
        {
            throw new InvalidOperationException("Configure a valid authenticated Redis connection before starting Syncode outside Development.", exception);
        }
    }

    private static bool IsPrivateAddress(IPAddress address)
    {
        var bytes = address.GetAddressBytes();
        if (address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork)
            return bytes[0] == 10 ||
                bytes[0] == 172 && bytes[1] is >= 16 and <= 31 ||
                bytes[0] == 192 && bytes[1] == 168;

        return address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetworkV6 &&
            (bytes[0] & 0xfe) == 0xfc;
    }

    private static string Require(IConfiguration configuration, string key) =>
        !string.IsNullOrWhiteSpace(configuration[key])
            ? configuration[key]!.Trim()
            : throw new InvalidOperationException($"Configure {key} before starting Syncode outside Development.");
}
