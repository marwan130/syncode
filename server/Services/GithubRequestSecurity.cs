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
        var origin = request.Headers.Origin.ToString();
        if (!Uri.TryCreate(origin, UriKind.Absolute, out var parsed) ||
            parsed.AbsoluteUri.TrimEnd('/') != origin.TrimEnd('/'))
            return false;

        var allowedOrigins = AllowedOriginsConfiguration.Resolve(configuration, environment);
        return allowedOrigins?.Contains(origin, StringComparer.OrdinalIgnoreCase) == true;
    }
}
