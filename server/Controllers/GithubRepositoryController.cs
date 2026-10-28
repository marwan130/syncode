using Microsoft.AspNetCore.Mvc;
using server.Models;
using server.Services;

namespace server.Controllers;

[ApiController]
[Route("api/github/repository")]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class GithubRepositoryController(
    GithubRepositoryImportService importService,
    GithubRepositoryPushService pushService,
    GithubRepositoryBrowserService browserService,
    GithubRepositoryAccessStore repositoryAccess,
    IConfiguration configuration,
    IWebHostEnvironment environment) : ControllerBase
{
    private const string SessionCookieName = "syncode_github_session";

    [HttpGet("repositories")]
    public Task<IActionResult> ListRepositories(CancellationToken cancellationToken) =>
        RunBrowserRequestAsync(
            () => browserService.ListRepositoriesAsync(GetSessionId(), cancellationToken));

    [HttpGet("branches")]
    public Task<IActionResult> ListBranches(
        [FromQuery] string owner,
        [FromQuery] string name,
        CancellationToken cancellationToken) =>
        RunBrowserRequestAsync(
            () => browserService.ListBranchesAsync(owner, name, GetSessionId(), cancellationToken));

    [HttpGet("history")]
    public Task<IActionResult> ListHistory(
        [FromQuery] string owner,
        [FromQuery] string name,
        [FromQuery] string branch,
        CancellationToken cancellationToken) =>
        RunBrowserRequestAsync(
            () => browserService.ListHistoryAsync(owner, name, branch, GetSessionId(), cancellationToken));

    [HttpGet("commit")]
    public Task<IActionResult> GetCommitDetails(
        [FromQuery] string owner,
        [FromQuery] string name,
        [FromQuery] string sha,
        CancellationToken cancellationToken) =>
        RunBrowserRequestAsync(
            () => browserService.GetCommitDetailsAsync(owner, name, sha, GetSessionId(), cancellationToken));

    [HttpGet("file")]
    public Task<IActionResult> GetFileContent(
        [FromQuery] string owner,
        [FromQuery] string name,
        [FromQuery] string sha,
        CancellationToken cancellationToken) =>
        RunBrowserRequestAsync(
            () => browserService.GetFileContentAsync(owner, name, sha, GetSessionId(), cancellationToken));

    [HttpPost("branches")]
    [RequestSizeLimit(4096)]
    public Task<IActionResult> CreateBranch(
        [FromBody] GithubBranchRequest? request,
        CancellationToken cancellationToken) =>
        request is null
            ? Task.FromResult<IActionResult>(BadRequest(new { error = "invalid_request" }))
            : RunBrowserRequestAsync(
                () => browserService.CreateBranchAsync(request, GetSessionId(), cancellationToken));

    [HttpPost("branches/rename")]
    [RequestSizeLimit(4096)]
    public Task<IActionResult> RenameBranch(
        [FromBody] GithubRenameBranchRequest? request,
        CancellationToken cancellationToken) =>
        request is null
            ? Task.FromResult<IActionResult>(BadRequest(new { error = "invalid_request" }))
            : RunBrowserRequestAsync(async () =>
            {
                await browserService.RenameBranchAsync(request, GetSessionId(), cancellationToken);
                return new { success = true };
            });

    [HttpDelete("branches")]
    public Task<IActionResult> DeleteBranch(
        [FromQuery] string owner,
        [FromQuery] string name,
        [FromQuery] string branch,
        CancellationToken cancellationToken) =>
        RunBrowserRequestAsync(async () =>
        {
            await browserService.DeleteBranchAsync(owner, name, branch, GetSessionId(), cancellationToken);
            return new { success = true };
        });

    [HttpPost("import")]
    [RequestSizeLimit(4096)]
    public async Task<IActionResult> Import(
        [FromBody] GithubRepositoryImportRequest? request,
        CancellationToken cancellationToken)
    {
        if (!GithubRequestSecurity.HasTrustedOrigin(Request, configuration, environment))
            return StatusCode(StatusCodes.Status403Forbidden);
        if (request is null) return BadRequest(new { error = "invalid_request" });
        var actorId = await repositoryAccess.ValidateAdminGrantAsync(
            Request.Headers["X-Syncode-Admin-Grant"].FirstOrDefault(), request.RoomId);
        if (actorId is null) return StatusCode(StatusCodes.Status403Forbidden);
        try
        {
            var result = await importService.ImportAsync(
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
            return StatusCode(StatusCodes.Status403Forbidden);
        if (request is null) return BadRequest(new { error = "invalid_request" });
        try
        {
            var result = await pushService.PushAsync(
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

    private async Task<IActionResult> RunBrowserRequestAsync<T>(Func<Task<T>> operation)
    {
        if (!GithubRequestSecurity.HasTrustedOrigin(Request, configuration, environment))
            return StatusCode(StatusCodes.Status403Forbidden);
        try
        {
            return Ok(await operation());
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
}
