using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Syncode.ExecutionService.Queue;
using Syncode.ExecutionService.Runner;
using Syncode.ExecutionService.Security;

namespace Syncode.ExecutionService.Api;

internal static class ExecutionEndpoints
{
    private sealed record TerminalStartRequest(IReadOnlyList<TerminalWorkspaceEntry>? Entries);

    internal static void Map(WebApplication app, string apiKey)
    {
        MapTerminalEndpoints(app, apiKey);
        MapExecutionJobEndpoints(app, apiKey);
    }

    private static void MapTerminalEndpoints(WebApplication app, string apiKey)
    {
        app.MapPost("/api/terminals", async (
            HttpContext context,
            InteractiveTerminalSessions terminals,
            CancellationToken cancellationToken) =>
        {
            if (!HasValidApiKey(context, apiKey)) return Results.Unauthorized();
            var bodySize = context.Features.Get<Microsoft.AspNetCore.Http.Features.IHttpMaxRequestBodySizeFeature>();
            if (bodySize is { IsReadOnly: false }) bodySize.MaxRequestBodySize = 64 * 1024 * 1024;
            if (context.Request.ContentLength > 64 * 1024 * 1024)
                return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);
            TerminalStartRequest? request;
            try { request = await context.Request.ReadFromJsonAsync<TerminalStartRequest>(cancellationToken); }
            catch (JsonException) { return Results.BadRequest(new { error = "Invalid workspace snapshot." }); }
            if (request?.Entries is null) return Results.BadRequest(new { error = "Invalid workspace snapshot." });
            try { return Results.Ok(await terminals.CreateAsync(request.Entries, cancellationToken)); }
            catch (TerminalSessionLimitException exception)
            {
                return Results.Problem(exception.Message, statusCode: StatusCodes.Status429TooManyRequests);
            }
            catch (ArgumentException)
            {
                return Results.BadRequest(new { error = "The room workspace is invalid or exceeds its size limit." });
            }
            catch (Exception exception) when (
                exception is IOException or InvalidOperationException or System.ComponentModel.Win32Exception)
            {
                return Results.Problem(
                    "The isolated Bash terminal could not start. Check that Docker is available and the syncode-runner-bash image is built.",
                    statusCode: StatusCodes.Status503ServiceUnavailable);
            }
        });

        app.MapPost("/api/terminals/{sessionId}/input", async (
            HttpContext context,
            string sessionId,
            InputRequest request,
            InteractiveTerminalSessions terminals,
            CancellationToken cancellationToken) =>
        {
            if (!HasValidApiKey(context, apiKey)) return Results.Unauthorized();
            try
            {
                await terminals.WriteInputAsync(sessionId, request.Input, cancellationToken);
                return Results.NoContent();
            }
            catch (KeyNotFoundException) { return Results.NotFound(); }
            catch (ArgumentException exception) { return Results.BadRequest(new { error = exception.Message }); }
            catch (InvalidOperationException exception) { return Results.Conflict(new { error = exception.Message }); }
        });

        app.MapGet("/api/terminals/{sessionId}/output", async (
            HttpContext context,
            string sessionId,
            int offset,
            InteractiveTerminalSessions terminals,
            CancellationToken cancellationToken) =>
        {
            if (!HasValidApiKey(context, apiKey)) return Results.Unauthorized();
            if (offset < 0) return Results.BadRequest(new { error = "Invalid terminal output offset." });
            try { return Results.Ok(await terminals.ReadOutputAsync(sessionId, offset, cancellationToken)); }
            catch (KeyNotFoundException) { return Results.NotFound(); }
        });

        app.MapDelete("/api/terminals/{sessionId}", async (
            HttpContext context,
            string sessionId,
            InteractiveTerminalSessions terminals) =>
        {
            if (!HasValidApiKey(context, apiKey)) return Results.Unauthorized();
            await terminals.CloseAsync(sessionId);
            return Results.NoContent();
        });
    }

    private static void MapExecutionJobEndpoints(WebApplication app, string apiKey)
    {
        app.MapPost("/api/executions", async (
            HttpContext context,
            QueueExecutionRequest request,
            ExecutionJobQueue queue,
            ExecutionRateLimiter rateLimiter,
            CancellationToken cancellationToken) =>
        {
            if (!HasValidApiKey(context, apiKey)) return Results.Unauthorized();
            if (!IsValidRequest(request)) return Results.BadRequest(new { error = "Invalid execution request." });

            var rateLimit = await rateLimiter.TryAcquireAsync(
                request.RoomId, Guid.NewGuid().ToString("N"), cancellationToken);
            if (!rateLimit.Allowed)
            {
                context.Response.Headers.RetryAfter = Math.Max(
                    1, (int)Math.Ceiling(rateLimit.RetryAfter.TotalSeconds))
                    .ToString(System.Globalization.CultureInfo.InvariantCulture);
                return Results.Json(
                    new { error = "Execution rate limit reached. Please wait before submitting another run." },
                    statusCode: StatusCodes.Status429TooManyRequests);
            }

            var job = CreateJob(request);
            var enqueue = await queue.EnqueueOrGetAsync(job, cancellationToken);
            return enqueue.IsFull
                ? Results.Problem("The execution queue is full. Try again shortly.", statusCode: StatusCodes.Status503ServiceUnavailable)
                : Results.Accepted($"/api/executions/{enqueue.JobId}", new { jobId = enqueue.JobId, queuePosition = enqueue.QueuePosition });
        });

        app.MapGet("/api/executions/{jobId}", async (
            HttpContext context,
            string jobId,
            ExecutionJobQueue queue,
            CancellationToken cancellationToken) =>
        {
            if (!HasValidApiKey(context, apiKey)) return Results.Unauthorized();
            if (!IsValidJobId(jobId)) return Results.BadRequest(new { error = "Invalid execution id." });
            var status = await queue.GetStatusAsync(jobId, cancellationToken);
            return status is null ? Results.NotFound() : Results.Ok(status);
        });

        app.MapPost("/api/executions/{jobId}/input", async (
            HttpContext context,
            string jobId,
            InputRequest request,
            DockerCli docker,
            CancellationToken cancellationToken) =>
        {
            if (!HasValidApiKey(context, apiKey)) return Results.Unauthorized();
            if (!IsValidTerminalInput(jobId, request.Input))
                return Results.BadRequest(new { error = "Invalid terminal input." });
            try
            {
                await docker.WriteExecutionInputAsync(jobId, request.Input, cancellationToken);
                return Results.NoContent();
            }
            catch (ExecutionInputBufferLimitException) { return Results.StatusCode(StatusCodes.Status429TooManyRequests); }
            catch (KeyNotFoundException) { return Results.NotFound(); }
            catch (InvalidOperationException) { return Results.NotFound(); }
            catch (IOException) { return Results.Conflict(new { error = "This execution is no longer accepting input." }); }
        });
    }

    private static bool IsValidRequest(QueueExecutionRequest request)
    {
        return IsValidIdentity(request) && IsValidProjectFiles(request) &&
            IsValidSourceSize(request) && IsValidRequestId(request.RequestId) &&
            Enum.IsDefined(request.Language);
    }

    private static bool IsValidIdentity(QueueExecutionRequest request) =>
        !string.IsNullOrWhiteSpace(request.RoomId) && request.RoomId.Length <= 128 &&
        !string.IsNullOrWhiteSpace(request.RequestedBy) && request.RequestedBy.Length <= 128;

    private static bool IsValidProjectFiles(QueueExecutionRequest request) =>
        request.ProjectFiles is { Count: >= 1 and <= 500 } files &&
        IsSafeProjectPath(request.SourcePath) &&
        files.All(file => file is not null && file.Content is not null && IsSafeProjectPath(file.Path)) &&
        files.Any(file => file.Path == request.SourcePath) &&
        files.Select(file => file.Path).Distinct(StringComparer.Ordinal).Count() == files.Count;

    private static bool IsValidSourceSize(QueueExecutionRequest request)
    {
        if (request.Source is null || request.ProjectFiles is not { } files) return false;
        var sourceSize = Encoding.UTF8.GetByteCount(request.Source);
        var projectSize = files.Sum(file => (long)Encoding.UTF8.GetByteCount(file.Content));
        var sourceFileSize = files.First(file => file.Path == request.SourcePath).Content;
        return sourceSize <= ResourceLimits.Default.MaxSourceBytes &&
            projectSize - Encoding.UTF8.GetByteCount(sourceFileSize) +
            sourceSize <= ResourceLimits.Default.MaxSourceBytes;
    }

    private static bool IsValidRequestId(string? requestId) =>
        requestId is null || Guid.TryParse(requestId, out _);

    private static ExecutionJob CreateJob(QueueExecutionRequest request) => new(
        Guid.NewGuid().ToString("N"), request.RoomId, request.RequestedBy, request.Language,
        request.Source, DateTimeOffset.UtcNow, request.RequestId is null
            ? Guid.NewGuid().ToString("N")
            : Guid.Parse(request.RequestId).ToString("D"), request.SourcePath, request.ProjectFiles);

    private static bool IsValidJobId(string jobId) =>
        jobId.Length == 32 && jobId.All(Uri.IsHexDigit);

    private static bool IsValidTerminalInput(string jobId, string input) =>
        IsValidJobId(jobId) && !string.IsNullOrEmpty(input) && input.Length <= 1024 &&
        input.All(character => !char.IsControl(character) ||
            character is '\r' or '\n' or '\t' or '\b' or '\x1b' or '\x03');

    private static bool HasValidApiKey(HttpContext context, string expected)
    {
        if (!context.Request.Headers.TryGetValue("X-Execution-Service-Key", out var supplied))
            return false;
        var expectedBytes = Encoding.UTF8.GetBytes(expected);
        var suppliedBytes = Encoding.UTF8.GetBytes(supplied.ToString());
        return suppliedBytes.Length == expectedBytes.Length &&
            CryptographicOperations.FixedTimeEquals(suppliedBytes, expectedBytes);
    }

    private static bool IsSafeProjectPath(string path)
    {
        if (string.IsNullOrWhiteSpace(path) || path.Length > 512 || path.StartsWith('/') ||
            path.Contains('\\') || path.Any(char.IsControl)) return false;
        return path.Split('/').All(segment => segment.Length > 0 && segment is not "." and not ".." &&
            segment.IndexOfAny([':', '*', '?', '"', '<', '>', '|']) < 0);
    }
}
