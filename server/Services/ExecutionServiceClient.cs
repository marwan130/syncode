using System.Net;
using System.Net.WebSockets;
using System.Net.Http.Json;
using System.Text.Encodings.Web;
using System.Text.Json;
using Microsoft.AspNetCore.SignalR;
using server.Application.Execution;
using server.Application.Projects;
using server.Application.Rooms;

namespace server.Services;

public sealed record ExecutionLanguageServerStart(string SessionId);

public sealed class ExecutionServiceClient(HttpClient httpClient, IConfiguration configuration) : IExecutionGateway
{
    private static readonly JsonSerializerOptions TerminalJsonOptions = new(JsonSerializerDefaults.Web)
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
    };

    public async Task<TerminalSessionStartResult> StartTerminalAsync(
        string roomId,
        IReadOnlyList<RoomWorkspaceEntry> entries,
        CancellationToken cancellationToken) =>
        await SendTerminalAsync<TerminalSessionStartResult>(
            HttpMethod.Post,
            "api/terminals",
            JsonContent.Create(new { roomId, entries }, options: TerminalJsonOptions),
            cancellationToken)
        ?? throw new RoomOperationException("The terminal service returned an invalid response.");

    public async Task<ExecutionLanguageServerStart> StartLanguageServerAsync(
        string roomId,
        string language,
        IReadOnlyList<RoomWorkspaceEntry> entries,
        CancellationToken cancellationToken) =>
        await SendTerminalAsync<ExecutionLanguageServerStart>(
            HttpMethod.Post,
            "api/language-servers",
            JsonContent.Create(new { roomId, language, entries }, options: TerminalJsonOptions),
            cancellationToken)
        ?? throw new RoomOperationException("The language server returned an invalid response.");

    public async Task CloseLanguageServerAsync(string sessionId, CancellationToken cancellationToken)
    {
        using var request = CreateTerminalRequest(
            HttpMethod.Delete,
            $"api/language-servers/{Uri.EscapeDataString(sessionId)}");
        using var response = await SendTerminalRequestAsync(request, cancellationToken);
        if (response.StatusCode != HttpStatusCode.NotFound && !response.IsSuccessStatusCode)
            throw await TerminalErrorAsync(response, cancellationToken);
    }

    public async Task ProxyLanguageServerAsync(
        string sessionId,
        WebSocket browserSocket,
        CancellationToken cancellationToken)
    {
        var baseUrl = configuration["ExecutionService:BaseUrl"];
        var apiKey = configuration["ExecutionService:ApiKey"] ?? configuration["SYNCODE_EXECUTION_API_KEY"];
        if (!Uri.TryCreate(baseUrl, UriKind.Absolute, out var serviceUri) || string.IsNullOrWhiteSpace(apiKey))
            throw new RoomOperationException("Code execution is not configured on this server.");

        var socketUri = new UriBuilder(new Uri(new Uri(serviceUri.ToString().TrimEnd('/') + "/"),
            $"api/language-servers/{Uri.EscapeDataString(sessionId)}/socket"))
        {
            Scheme = serviceUri.Scheme == Uri.UriSchemeHttps ? "wss" : "ws",
        }.Uri;
        using var executionSocket = new ClientWebSocket();
        executionSocket.Options.SetRequestHeader("X-Execution-Service-Key", apiKey);
        using var bridge = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        try
        {
            await executionSocket.ConnectAsync(socketUri, bridge.Token);
            var browserToExecution = RelayWebSocketAsync(browserSocket, executionSocket, bridge.Token);
            var executionToBrowser = RelayWebSocketAsync(executionSocket, browserSocket, bridge.Token);
            await Task.WhenAny(browserToExecution, executionToBrowser);
            bridge.Cancel();
            await IgnoreExpectedWebSocketStopAsync(Task.WhenAll(browserToExecution, executionToBrowser));
        }
        finally
        {
            executionSocket.Abort();
            if (browserSocket.State is WebSocketState.Open or WebSocketState.CloseReceived)
            {
                try { await browserSocket.CloseAsync(WebSocketCloseStatus.NormalClosure, "Language server closed", CancellationToken.None); }
                catch (WebSocketException) { }
            }
        }
    }

    public async Task DeleteRoomDependenciesAsync(string roomId, CancellationToken cancellationToken)
    {
        using var request = CreateTerminalRequest(HttpMethod.Delete,
            $"api/rooms/{Uri.EscapeDataString(roomId)}/dependencies");
        using var response = await SendTerminalRequestAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode) throw await TerminalErrorAsync(response, cancellationToken);
    }

    public async Task WriteTerminalInputAsync(string sessionId, string input, CancellationToken cancellationToken)
    {
        using var request = CreateTerminalRequest(HttpMethod.Post, $"api/terminals/{Uri.EscapeDataString(sessionId)}/input");
        request.Content = JsonContent.Create(new { input });
        using var response = await SendTerminalRequestAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode) throw await TerminalErrorAsync(response, cancellationToken);
    }

    public async Task<TerminalOutputResult> ReadTerminalOutputAsync(string sessionId, int offset, CancellationToken cancellationToken) =>
        await SendTerminalAsync<TerminalOutputResult>(HttpMethod.Get,
            $"api/terminals/{Uri.EscapeDataString(sessionId)}/output?offset={offset}", null, cancellationToken)
        ?? throw new RoomOperationException("The terminal service returned an invalid response.");

    public async Task CloseTerminalAsync(string sessionId, CancellationToken cancellationToken)
    {
        using var request = CreateTerminalRequest(HttpMethod.Delete, $"api/terminals/{Uri.EscapeDataString(sessionId)}");
        using var response = await SendTerminalRequestAsync(request, cancellationToken);
        if (response.StatusCode != HttpStatusCode.NotFound && !response.IsSuccessStatusCode)
            throw await TerminalErrorAsync(response, cancellationToken);
    }

    public async Task RunTerminalFileAsync(
        string sessionId,
        string language,
        string sourcePath,
        IReadOnlyList<RoomWorkspaceEntry> entries,
        CancellationToken cancellationToken)
    {
        using var request = CreateTerminalRequest(
            HttpMethod.Post, $"api/terminals/{Uri.EscapeDataString(sessionId)}/run");
        request.Content = JsonContent.Create(new { language, sourcePath, entries }, options: TerminalJsonOptions);
        using var response = await SendTerminalRequestAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode) throw await TerminalErrorAsync(response, cancellationToken);
    }


    private async Task<T?> SendTerminalAsync<T>(HttpMethod method, string path, HttpContent? content, CancellationToken cancellationToken)
    {
        using var request = CreateTerminalRequest(method, path);
        request.Content = content;
        using var response = await SendTerminalRequestAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode) throw await TerminalErrorAsync(response, cancellationToken);
        return await response.Content.ReadFromJsonAsync<T>(cancellationToken);
    }

    private HttpRequestMessage CreateTerminalRequest(HttpMethod method, string path)
    {
        var baseUrl = configuration["ExecutionService:BaseUrl"];
        var apiKey = configuration["ExecutionService:ApiKey"] ?? configuration["SYNCODE_EXECUTION_API_KEY"];
        if (!Uri.TryCreate(baseUrl, UriKind.Absolute, out var serviceUri) || string.IsNullOrWhiteSpace(apiKey))
            throw new RoomOperationException("Code execution is not configured on this server.");
        var request = new HttpRequestMessage(method,
            new Uri(new Uri(serviceUri.ToString().TrimEnd('/') + "/"), path));
        request.Headers.TryAddWithoutValidation("X-Execution-Service-Key", apiKey);
        return request;
    }

    private async Task<HttpResponseMessage> SendTerminalRequestAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        try { return await httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken); }
        catch (HttpRequestException) { throw new RoomOperationException("The terminal service is unavailable."); }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        { throw new RoomOperationException("The terminal service did not respond in time."); }
    }

    private static async Task RelayWebSocketAsync(
        WebSocket source,
        WebSocket destination,
        CancellationToken cancellationToken)
    {
        var buffer = new byte[16 * 1024];
        while (!cancellationToken.IsCancellationRequested && source.State == WebSocketState.Open)
        {
            var message = await source.ReceiveAsync(new ArraySegment<byte>(buffer), cancellationToken);
            if (message.MessageType == WebSocketMessageType.Close)
            {
                if (destination.State is WebSocketState.Open or WebSocketState.CloseReceived)
                    await destination.CloseOutputAsync(message.CloseStatus ?? WebSocketCloseStatus.NormalClosure,
                        message.CloseStatusDescription, CancellationToken.None);
                return;
            }
            await destination.SendAsync(buffer.AsMemory(0, message.Count), message.MessageType,
                message.EndOfMessage, cancellationToken);
        }
    }

    private static async Task IgnoreExpectedWebSocketStopAsync(Task task)
    {
        try { await task; }
        catch (Exception exception) when (exception is OperationCanceledException or IOException or WebSocketException or InvalidOperationException) { }
    }

    private static async Task<RoomOperationException> TerminalErrorAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        if (response.StatusCode == HttpStatusCode.NotFound) return new RoomOperationException("Terminal session has ended.");
        return new RoomOperationException(await ReadErrorMessageAsync(response, cancellationToken));
    }

    private static async Task<string> ReadErrorMessageAsync(
        HttpResponseMessage response,
        CancellationToken cancellationToken)
    {
        try
        {
            using var document = await JsonDocument.ParseAsync(
                await response.Content.ReadAsStreamAsync(cancellationToken),
                cancellationToken: cancellationToken);
            foreach (var property in new[] { "error", "detail", "title" })
            {
                if (document.RootElement.TryGetProperty(property, out var value) &&
                    value.ValueKind == JsonValueKind.String &&
                    !string.IsNullOrWhiteSpace(value.GetString()))
                {
                    return value.GetString()!;
                }
            }
        }
        catch (JsonException) { }

        return "The terminal request failed. Please try again.";
    }
}
