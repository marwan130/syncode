using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Net.WebSockets;
using Syncode.ExecutionService.Runner;

namespace Syncode.ExecutionService.Api;

internal static class ExecutionEndpoints
{
    private sealed record TerminalStartRequest(string? RoomId, IReadOnlyList<TerminalWorkspaceEntry>? Entries);
    private sealed record InputRequest(string Input);
    private sealed record RunTerminalFileRequest(string? Language, string? SourcePath, IReadOnlyList<TerminalWorkspaceEntry>? Entries);
    private sealed record LanguageServerStartRequest(string? RoomId, string? Language, IReadOnlyList<TerminalWorkspaceEntry>? Entries);

    internal static void Map(WebApplication app, string apiKey)
    {
        MapTerminalEndpoints(app, apiKey);
        MapLanguageServerEndpoints(app, apiKey);
    }

    private static void MapLanguageServerEndpoints(WebApplication app, string apiKey)
    {
        app.MapPost("/api/language-servers", async (
            HttpContext context,
            [Microsoft.AspNetCore.Mvc.FromBody] LanguageServerStartRequest? request,
            LanguageServerSessions sessions,
            CancellationToken cancellationToken) =>
        {
            if (!HasValidApiKey(context, apiKey)) return Results.Unauthorized();
            if (request?.RoomId is not { Length: > 0 and <= 128 } roomId ||
                request.Language is not { Length: > 0 and <= 32 } language || request.Entries is null)
                return Results.BadRequest(new { error = "Invalid language server request." });
            var bodySize = context.Features.Get<Microsoft.AspNetCore.Http.Features.IHttpMaxRequestBodySizeFeature>();
            if (bodySize is { IsReadOnly: false }) bodySize.MaxRequestBodySize = 64 * 1024 * 1024;
            if (context.Request.ContentLength > 64 * 1024 * 1024)
                return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);
            try { return Results.Ok(await sessions.CreateAsync(roomId, language, request.Entries, cancellationToken)); }
            catch (LanguageServerCapacityException) { return Results.StatusCode(StatusCodes.Status429TooManyRequests); }
            catch (ArgumentException exception) { return Results.BadRequest(new { error = exception.Message }); }
            catch (Exception exception) when (exception is IOException or InvalidOperationException or System.ComponentModel.Win32Exception)
            {
                return Results.Problem("The language server could not start.", statusCode: StatusCodes.Status503ServiceUnavailable);
            }
        });

        app.MapGet("/api/language-servers/{sessionId}/socket", async (
            HttpContext context,
            string sessionId,
            LanguageServerSessions sessions,
            CancellationToken cancellationToken) =>
        {
            if (!HasValidApiKey(context, apiKey)) return Results.Unauthorized();
            if (!IsValidJobId(sessionId)) return Results.BadRequest();
            if (!context.WebSockets.IsWebSocketRequest) return Results.BadRequest();
            using var socket = await context.WebSockets.AcceptWebSocketAsync();
            try { await sessions.ProxyAsync(sessionId, socket, cancellationToken); }
            catch (KeyNotFoundException) { await socket.CloseAsync(WebSocketCloseStatus.PolicyViolation, "Language server session ended", CancellationToken.None); }
            catch (Exception exception) when (exception is WebSocketException or IOException or InvalidDataException or JsonException)
            {
                if (socket.State is WebSocketState.Open or WebSocketState.CloseReceived)
                    await socket.CloseAsync(WebSocketCloseStatus.InvalidMessageType, "Invalid language server connection", CancellationToken.None);
            }
            return Results.Empty;
        });

        app.MapDelete("/api/language-servers/{sessionId}", async (
            HttpContext context,
            string sessionId,
            LanguageServerSessions sessions) =>
        {
            if (!HasValidApiKey(context, apiKey)) return Results.Unauthorized();
            if (!IsValidJobId(sessionId)) return Results.BadRequest();
            await sessions.CloseAsync(sessionId);
            return Results.NoContent();
        });
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
            if (request?.Entries is null || string.IsNullOrWhiteSpace(request.RoomId) || request.RoomId.Length > 128)
                return Results.BadRequest(new { error = "Invalid workspace snapshot." });
            try { return Results.Ok(await terminals.CreateAsync(request.RoomId, request.Entries, cancellationToken)); }
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

        app.MapPost("/api/terminals/{sessionId}/run", async (
            HttpContext context,
            string sessionId,
            InteractiveTerminalSessions terminals,
            CancellationToken cancellationToken) =>
        {
            if (!HasValidApiKey(context, apiKey)) return Results.Unauthorized();
            var bodySize = context.Features.Get<Microsoft.AspNetCore.Http.Features.IHttpMaxRequestBodySizeFeature>();
            if (bodySize is { IsReadOnly: false }) bodySize.MaxRequestBodySize = 64 * 1024 * 1024;
            if (context.Request.ContentLength > 64 * 1024 * 1024)
                return Results.StatusCode(StatusCodes.Status413PayloadTooLarge);
            RunTerminalFileRequest? request;
            try { request = await context.Request.ReadFromJsonAsync<RunTerminalFileRequest>(cancellationToken); }
            catch (JsonException) { return Results.BadRequest(new { error = "Invalid run request." }); }
            if (request?.Language is not { Length: > 0 and <= 32 } language ||
                request.SourcePath is not { Length: > 0 and <= 512 } sourcePath || request.Entries is null)
                return Results.BadRequest(new { error = "Invalid run request." });
            try
            {
                await terminals.RunFileAsync(sessionId, language, sourcePath, request.Entries, cancellationToken);
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

        app.MapDelete("/api/rooms/{roomId}/dependencies", (
            HttpContext context,
            string roomId,
            RoomDependencyStore dependencies) =>
        {
            if (!HasValidApiKey(context, apiKey)) return Results.Unauthorized();
            if (string.IsNullOrWhiteSpace(roomId) || roomId.Length > 128)
                return Results.BadRequest(new { error = "Invalid room id." });
            dependencies.DeleteRoom(roomId);
            return Results.NoContent();
        });
    }

    private static bool HasValidApiKey(HttpContext context, string expected)
    {
        if (!context.Request.Headers.TryGetValue("X-Execution-Service-Key", out var supplied))
            return false;
        var expectedBytes = Encoding.UTF8.GetBytes(expected);
        var suppliedBytes = Encoding.UTF8.GetBytes(supplied.ToString());
        return suppliedBytes.Length == expectedBytes.Length &&
            CryptographicOperations.FixedTimeEquals(suppliedBytes, expectedBytes);
    }

    private static bool IsValidJobId(string id) => id.Length == 32 && id.All(Uri.IsHexDigit);
}
