using System.Security.Cryptography;
using System.Text.Json;
using System.Net.WebSockets;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.SignalR;
using server.Application.Projects;
using server.Application.Rooms;
using StackExchange.Redis;

namespace server.Services;

public sealed record LanguageServerStartResult(string Ticket);

public sealed class LanguageServerSessionService(
    IConnectionMultiplexer redis,
    RedisParticipantStore participants,
    RoomAuthorizationService authorization,
    RoomWorkspaceAdapter workspace,
    ExecutionServiceClient executionService,
    IConfiguration configuration,
    IHostEnvironment environment)
{
    private const int MaximumSessionsPerConnection = 4;
    private static readonly TimeSpan SessionLifetime = TimeSpan.FromMinutes(30);
    private static readonly TimeSpan TicketLifetime = TimeSpan.FromMinutes(1);
    private const string SessionPrefix = "syncode:lsp:session:";
    private const string ConnectionPrefix = "syncode:lsp:connection:";
    private const string TicketPrefix = "syncode:lsp:ticket:";
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private const string ReserveSessionScript = """
        local count = redis.call('SCARD', KEYS[1])
        if count >= tonumber(ARGV[1]) then return 0 end
        redis.call('SADD', KEYS[1], ARGV[2])
        redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3]))
        return 1
        """;
    private const string ConsumeTicketScript = """
        local value = redis.call('GET', KEYS[1])
        if value then redis.call('DEL', KEYS[1]) end
        return value
        """;

    public async Task<LanguageServerStartResult> StartAsync(
        string connectionId,
        string language,
        CancellationToken cancellationToken)
    {
        var roomId = await participants.GetConnectionRoomAsync(connectionId);
        if (string.IsNullOrWhiteSpace(roomId))
            throw new RoomOperationException("Join a room before starting language tools.");
        await authorization.EnsureParticipantAsync(roomId, connectionId);
        var reservation = $"pending-{Guid.NewGuid():N}";
        var database = redis.GetDatabase();
        var connectionKey = ConnectionKey(connectionId);
        var reserved = (long)await database.ScriptEvaluateAsync(
            ReserveSessionScript,
            [connectionKey],
            [MaximumSessionsPerConnection, reservation, (int)SessionLifetime.TotalSeconds]);
        if (reserved != 1)
            throw new RoomOperationException("Too many language tools are open in this room connection.");

        string? sessionId = null;
        try
        {
            var entries = await workspace.MaterializeAsync(roomId);
            var session = await executionService.StartLanguageServerAsync(roomId, language, entries, cancellationToken);
            sessionId = session.SessionId;
            var metadata = new LanguageServerSession(roomId, connectionId, sessionId);
            var serialized = JsonSerializer.Serialize(metadata, JsonOptions);
            await database.SetRemoveAsync(connectionKey, reservation);
            await database.SetAddAsync(connectionKey, sessionId);
            await database.KeyExpireAsync(connectionKey, SessionLifetime);
            await database.StringSetAsync(SessionKey(sessionId), serialized, SessionLifetime);

            var ticket = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
            await database.StringSetAsync(TicketKey(ticket), serialized, TicketLifetime);
            return new LanguageServerStartResult(ticket);
        }
        catch
        {
            await database.SetRemoveAsync(connectionKey, sessionId ?? reservation);
            if (sessionId is not null)
            {
                try { await executionService.CloseLanguageServerAsync(sessionId, CancellationToken.None); }
                catch (Exception exception) when (exception is HubException or RoomOperationException) { }
            }
            throw;
        }
    }

    public async Task ProxyAsync(HttpContext context)
    {
        var ticketValues = context.Request.Query["ticket"];
        if (!context.WebSockets.IsWebSocketRequest || !IsAllowedOrigin(context) || ticketValues.Count != 1 ||
            !IsTicket(ticketValues.ToString()))
        {
            context.Response.StatusCode = context.WebSockets.IsWebSocketRequest
                ? StatusCodes.Status403Forbidden
                : StatusCodes.Status400BadRequest;
            return;
        }

        var database = redis.GetDatabase();
        var ticket = ticketValues.ToString();
        var raw = await database.ScriptEvaluateAsync(ConsumeTicketScript, [TicketKey(ticket)]);
        var serialized = raw.IsNull ? null : raw.ToString();
        var ticketSession = Deserialize(serialized);
        if (ticketSession is null)
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return;
        }

        var activeSession = Deserialize(await database.StringGetAsync(SessionKey(ticketSession.SessionId)));
        if (activeSession != ticketSession ||
            !await participants.IsParticipantAsync(ticketSession.RoomId, ticketSession.ConnectionId))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            await CloseSessionAsync(ticketSession, CancellationToken.None);
            return;
        }

        using var browserSocket = await context.WebSockets.AcceptWebSocketAsync();
        try
        {
            await executionService.ProxyLanguageServerAsync(
                ticketSession.SessionId,
                browserSocket,
                context.RequestAborted);
        }
        catch (Exception exception) when (exception is HubException or RoomOperationException or WebSocketException or IOException)
        {
            if (browserSocket.State is WebSocketState.Open or WebSocketState.CloseReceived)
                await browserSocket.CloseAsync(WebSocketCloseStatus.InternalServerError, "Language server unavailable", CancellationToken.None);
        }
        finally
        {
            await CloseSessionAsync(ticketSession, CancellationToken.None);
        }
    }

    public async Task CloseConnectionSessionsAsync(string connectionId)
    {
        var database = redis.GetDatabase();
        var connectionKey = ConnectionKey(connectionId);
        var sessionIds = await database.SetMembersAsync(connectionKey);
        foreach (var member in sessionIds)
        {
            var sessionId = member.ToString();
            if (!IsSessionId(sessionId)) continue;
            var metadata = Deserialize(await database.StringGetAsync(SessionKey(sessionId)));
            if (metadata is not null) await CloseSessionAsync(metadata, CancellationToken.None);
            else await database.SetRemoveAsync(connectionKey, sessionId);
        }
        await database.KeyDeleteAsync(connectionKey);
    }

    private async Task CloseSessionAsync(LanguageServerSession session, CancellationToken cancellationToken)
    {
        var database = redis.GetDatabase();
        await database.KeyDeleteAsync(SessionKey(session.SessionId));
        await database.SetRemoveAsync(ConnectionKey(session.ConnectionId), session.SessionId);
        try { await executionService.CloseLanguageServerAsync(session.SessionId, cancellationToken); }
        catch (Exception exception) when (exception is HubException or RoomOperationException) { }
    }

    private static LanguageServerSession? Deserialize(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        try { return JsonSerializer.Deserialize<LanguageServerSession>(raw, JsonOptions); }
        catch (JsonException) { return null; }
    }

    private static bool IsTicket(string ticket) =>
        ticket.Length == 64 && ticket.All(Uri.IsHexDigit);

    private static bool IsSessionId(string sessionId) =>
        sessionId.Length == 32 && sessionId.All(Uri.IsHexDigit);

    private bool IsAllowedOrigin(HttpContext context)
    {
        var origin = context.Request.Headers.Origin.ToString();
        return Uri.TryCreate(origin, UriKind.Absolute, out var uri) &&
            string.IsNullOrEmpty(uri.UserInfo) && string.IsNullOrEmpty(uri.Query) &&
            string.IsNullOrEmpty(uri.Fragment) && uri.AbsolutePath == "/" &&
            AllowedOriginsConfiguration.Resolve(configuration, environment)
                .Contains(uri.GetLeftPart(UriPartial.Authority), StringComparer.OrdinalIgnoreCase);
    }

    private static string SessionKey(string sessionId) => $"{SessionPrefix}{sessionId}";
    private static string ConnectionKey(string connectionId) => $"{ConnectionPrefix}{connectionId}";
    private static string TicketKey(string ticket) => $"{TicketPrefix}{ticket}";

    private sealed record LanguageServerSession(string RoomId, string ConnectionId, string SessionId);
}
