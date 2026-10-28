using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;

namespace server.Services;

public static class GithubRequestSecurity
{
    public static bool HasTrustedOrigin(
        HttpRequest request,
        IConfiguration configuration,
        IWebHostEnvironment environment)
    {
        var allowedOrigins = AllowedOriginsConfiguration.Resolve(configuration, environment);
        var origin = request.Headers.Origin.ToString();
        if (!string.IsNullOrWhiteSpace(origin))
            return IsAllowedOrigin(origin, allowedOrigins);

        if (!HttpMethods.IsGet(request.Method) && !HttpMethods.IsHead(request.Method))
            return false;

        var fetchSite = request.Headers["Sec-Fetch-Site"].ToString();
        if (fetchSite.Length > 0)
            return string.Equals(fetchSite, "same-origin", StringComparison.OrdinalIgnoreCase);

        var referer = request.Headers.Referer.ToString();
        return Uri.TryCreate(referer, UriKind.Absolute, out var refererUri) &&
            allowedOrigins?.Contains(refererUri.GetLeftPart(UriPartial.Authority), StringComparer.OrdinalIgnoreCase) == true;
    }

    private static bool IsAllowedOrigin(string origin, IReadOnlyCollection<string>? allowedOrigins) =>
        Uri.TryCreate(origin, UriKind.Absolute, out var parsed) &&
        parsed.AbsoluteUri.TrimEnd('/') == origin.TrimEnd('/') &&
        allowedOrigins?.Contains(origin, StringComparer.OrdinalIgnoreCase) == true;
}
