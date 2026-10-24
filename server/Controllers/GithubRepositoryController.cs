using Microsoft.AspNetCore.Mvc;
using server.Models;
using server.Services;

namespace server.Controllers;

[ApiController]
[Route("api/github/repository")]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class GithubRepositoryController(
    GithubRepositoryService repositories,
    GithubRepositoryAccessStore repositoryAccess,
    IConfiguration configuration,
    IWebHostEnvironment environment) : ControllerBase
{
    private const string SessionCookieName = "syncode_github_session";

    [HttpPost("import")]
    [RequestSizeLimit(4096)]
    public async Task<IActionResult> Import(
        [FromBody] GithubRepositoryImportRequest? request,
        CancellationToken cancellationToken)
    {
        if (!GithubRequestSecurity.HasTrustedOrigin(Request, configuration, environment))
            return Forbid();
        if (request is null) return BadRequest(new { error = "invalid_request" });
        var actorId = await repositoryAccess.ValidateAdminGrantAsync(
            Request.Headers["X-Syncode-Admin-Grant"].FirstOrDefault(), request.RoomId);
        if (actorId is null) return Forbid();
        try
        {
            var result = await repositories.ImportAsync(
                request,
                GetSessionId(),
                actorId,
                cancellationToken);
            return Ok(result);
        }
        catch (GithubRepositoryException exception)
        {
            return StatusCode(exception.StatusCode, new { error = exception.Code });
        }
        catch (GithubOAuthException exception)
        {
            return StatusCode(
                exception.Unauthorized ? StatusCodes.Status401Unauthorized : StatusCodes.Status503ServiceUnavailable,
                new { error = exception.Unauthorized ? "reauthorize" : "github_unavailable" });
        }
    }

    [HttpPost("push")]
    [RequestSizeLimit(2 * 1024 * 1024)]
    public async Task<IActionResult> Push(
        [FromBody] GithubPushRequest? request,
        CancellationToken cancellationToken)
    {
        if (!GithubRequestSecurity.HasTrustedOrigin(Request, configuration, environment))
            return Forbid();
        if (request is null) return BadRequest(new { error = "invalid_request" });
        try
        {
            var result = await repositories.PushAsync(
                request,
                GetSessionId(),
                cancellationToken);
            return Ok(result);
        }
        catch (GithubRepositoryException exception)
        {
            return StatusCode(exception.StatusCode, new { error = exception.Code });
        }
        catch (GithubOAuthException exception)
        {
            return StatusCode(
                exception.Unauthorized ? StatusCodes.Status401Unauthorized : StatusCodes.Status503ServiceUnavailable,
                new { error = exception.Unauthorized ? "reauthorize" : "github_unavailable" });
        }
    }

    private string? GetSessionId() =>
        Request.Cookies.TryGetValue(SessionCookieName, out var sessionId) ? sessionId : null;
}
