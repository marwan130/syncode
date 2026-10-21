using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc;
using server.Models;
using server.Services;

namespace server.Controllers;

[ApiController]
[Route("api/github")]
public sealed partial class GithubAuthController(
    GithubOAuthService oauth,
    IConfiguration configuration,
    IWebHostEnvironment environment,
    ILogger<GithubAuthController> logger) : ControllerBase
{
    private const string SessionCookieName = "syncode_github_session";
    private const int MaxRequestBytes = 4096;

    [HttpPost("oauth/exchange")]
    [RequestSizeLimit(MaxRequestBytes)]
    public async Task<IActionResult> Exchange(
        [FromBody] GithubOAuthExchangeRequest? request,
        CancellationToken cancellationToken)
    {
        if (!HasTrustedOrigin()) return Forbid();
        if (request is null ||
            string.IsNullOrWhiteSpace(request.Code) || request.Code.Length > 512 ||
            string.IsNullOrWhiteSpace(request.CodeVerifier) ||
            !CodeVerifierPattern().IsMatch(request.CodeVerifier) ||
            request.RedirectUri is null || request.RedirectUri.OriginalString.Length > 512)
            return BadRequest(new { error = "invalid_request" });

        try
        {
            var session = await oauth.ExchangeAsync(request, cancellationToken);
            SetSessionCookie(session);
            return NoStore(Ok(new GithubSessionResponse(session.Account)));
        }
        catch (GithubOAuthException exception)
        {
            return OAuthError(exception);
        }
    }

    [HttpPost("session/refresh")]
    public async Task<IActionResult> GetSession(CancellationToken cancellationToken)
    {
        if (!HasTrustedOrigin()) return Forbid();
        if (!Request.Cookies.TryGetValue(SessionCookieName, out var sessionId))
            return Unauthorized(new { error = "unauthorized" });
        try
        {
            var session = await oauth.GetSessionAsync(sessionId, cancellationToken);
            SetSessionCookie(session);
            return NoStore(Ok(new GithubSessionResponse(session.Account)));
        }
        catch (GithubOAuthException exception)
        {
            if (exception.Unauthorized) ClearSessionCookie();
            return OAuthError(exception);
        }
    }

    [HttpDelete("session")]
    public async Task<IActionResult> DeleteSession(CancellationToken cancellationToken)
    {
        if (!HasTrustedOrigin()) return Forbid();
        var revoked = true;
        if (Request.Cookies.TryGetValue(SessionCookieName, out var sessionId))
        {
            try
            {
                revoked = await oauth.RevokeSessionAsync(sessionId, cancellationToken);
            }
            catch (GithubOAuthException)
            {
                revoked = false;
            }
            catch (HttpRequestException)
            {
                revoked = false;
            }
        }

        ClearSessionCookie();
        return revoked
            ? NoStore(NoContent())
            : NoStore(StatusCode(StatusCodes.Status502BadGateway, new { error = "revoke_failed" }));
    }

    private bool HasTrustedOrigin()
    {
        var origin = Request.Headers.Origin.ToString();
        if (!Uri.TryCreate(origin, UriKind.Absolute, out var parsed) ||
            parsed.AbsoluteUri.TrimEnd('/') != origin.TrimEnd('/'))
            return false;

        var allowedOrigins = AllowedOriginsConfiguration.Resolve(configuration, environment);
        return allowedOrigins?.Contains(origin, StringComparer.OrdinalIgnoreCase) == true;
    }

    private IActionResult OAuthError(GithubOAuthException exception)
    {
        var status = exception.Unauthorized
            ? StatusCodes.Status401Unauthorized
            : exception.Message.Contains("not configured", StringComparison.OrdinalIgnoreCase)
                ? StatusCodes.Status503ServiceUnavailable
                : StatusCodes.Status502BadGateway;
        logger.LogWarning(
            "GitHub OAuth request failed with status {StatusCode}.",
            status);
        if (exception.Unauthorized) ClearSessionCookie();
        return NoStore(StatusCode(status, new
        {
            error = exception.Unauthorized ? "reauthorize" : "oauth_failed"
        }));
    }

    private void SetSessionCookie(GithubOAuthSession session)
    {
        var remaining = session.CookieExpiresAt - DateTimeOffset.UtcNow;
        Response.Cookies.Append(SessionCookieName, session.SessionId, new CookieOptions
        {
            HttpOnly = true,
            Secure = !environment.IsDevelopment() || Request.IsHttps,
            SameSite = SameSiteMode.Lax,
            Path = "/api/github",
            IsEssential = true,
            MaxAge = remaining > TimeSpan.Zero ? remaining : TimeSpan.FromSeconds(1),
            Expires = session.CookieExpiresAt
        });
    }

    private void ClearSessionCookie()
    {
        Response.Cookies.Delete(SessionCookieName, new CookieOptions
        {
            HttpOnly = true,
            Secure = !environment.IsDevelopment() || Request.IsHttps,
            SameSite = SameSiteMode.Lax,
            Path = "/api/github"
        });
    }

    private IActionResult NoStore(IActionResult result)
    {
        Response.Headers.CacheControl = "no-store";
        Response.Headers.Pragma = "no-cache";
        return result;
    }

    [GeneratedRegex("^[A-Za-z0-9_-]{43,128}$", RegexOptions.CultureInvariant)]
    private static partial Regex CodeVerifierPattern();
}
