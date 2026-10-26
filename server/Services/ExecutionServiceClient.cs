using System.Net;
using System.Net.Http.Json;
using System.Text.Encodings.Web;
using System.Text.Json;
using Microsoft.AspNetCore.SignalR;

namespace server.Services;

public sealed class ExecutionServiceClient(HttpClient httpClient, IConfiguration configuration)
{
    private static readonly JsonSerializerOptions TerminalJsonOptions = new(JsonSerializerDefaults.Web)
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
    };

    public async Task<TerminalSessionStartResult> StartTerminalAsync(
        IReadOnlyList<RoomWorkspaceEntry> entries,
        CancellationToken cancellationToken) =>
        await SendTerminalAsync<TerminalSessionStartResult>(
            HttpMethod.Post,
            "api/terminals",
            JsonContent.Create(new { entries }, options: TerminalJsonOptions),
            cancellationToken)
        ?? throw new HubOperationException("The terminal service returned an invalid response.");

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
        ?? throw new HubOperationException("The terminal service returned an invalid response.");

    public async Task CloseTerminalAsync(string sessionId, CancellationToken cancellationToken)
    {
        using var request = CreateTerminalRequest(HttpMethod.Delete, $"api/terminals/{Uri.EscapeDataString(sessionId)}");
        using var response = await SendTerminalRequestAsync(request, cancellationToken);
        if (response.StatusCode != HttpStatusCode.NotFound && !response.IsSuccessStatusCode)
            throw await TerminalErrorAsync(response, cancellationToken);
    }

    public async Task<ExecutionSubmissionResult> SubmitAsync(
        ExecutionSubmissionRequest submission,
        CancellationToken cancellationToken)
    {
        using var request = CreateTerminalRequest(HttpMethod.Post, "api/executions");
        request.Content = JsonContent.Create(new
        {
            submission.RoomId,
            submission.RequestedBy,
            submission.Language,
            submission.Source,
            submission.SourcePath,
            submission.ProjectFiles,
            submission.RequestId,
        }, options: TerminalJsonOptions);

        HttpResponseMessage response;
        try
        {
            response = await httpClient.SendAsync(
                request,
                HttpCompletionOption.ResponseHeadersRead,
                cancellationToken);
        }
        catch (HttpRequestException)
        {
            throw new HubOperationException("The code execution service is unavailable.");
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new HubOperationException("The code execution service did not respond in time.");
        }

        using (response)
        {
            if (response.StatusCode == HttpStatusCode.Accepted)
            {
                var result = await response.Content.ReadFromJsonAsync<ExecutionSubmissionResult>(cancellationToken);
                return result ?? throw new HubOperationException("The execution service returned an invalid response.");
            }

            var message = await ReadErrorMessageAsync(response, cancellationToken);
            if (response.StatusCode == HttpStatusCode.TooManyRequests &&
                response.Headers.RetryAfter?.Delta is { } retryAfter)
            {
                message = $"Execution rate limit reached. Try again in {Math.Max(1, (int)Math.Ceiling(retryAfter.TotalSeconds))} seconds.";
            }
            throw new HubOperationException(message);
        }
    }

    public async Task WriteExecutionInputAsync(string jobId, string input, CancellationToken cancellationToken)
    {
        using var request = CreateTerminalRequest(HttpMethod.Post, $"api/executions/{Uri.EscapeDataString(jobId)}/input");
        request.Content = JsonContent.Create(new { input });
        using var response = await SendTerminalRequestAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode) throw await TerminalErrorAsync(response, cancellationToken);
    }

    public async Task CancelExecutionAsync(string jobId, CancellationToken cancellationToken)
    {
        using var request = CreateTerminalRequest(HttpMethod.Delete, $"api/executions/{Uri.EscapeDataString(jobId)}");
        using var response = await SendTerminalRequestAsync(request, cancellationToken);
        if (response.StatusCode is not HttpStatusCode.NotFound && !response.IsSuccessStatusCode)
            throw await TerminalErrorAsync(response, cancellationToken);
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
            throw new HubOperationException("Code execution is not configured on this server.");
        var request = new HttpRequestMessage(method,
            new Uri(new Uri(serviceUri.ToString().TrimEnd('/') + "/"), path));
        request.Headers.TryAddWithoutValidation("X-Execution-Service-Key", apiKey);
        return request;
    }

    private async Task<HttpResponseMessage> SendTerminalRequestAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        try { return await httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken); }
        catch (HttpRequestException) { throw new HubOperationException("The terminal service is unavailable."); }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        { throw new HubOperationException("The terminal service did not respond in time."); }
    }

    private static async Task<HubOperationException> TerminalErrorAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        if (response.StatusCode == HttpStatusCode.NotFound) return new HubOperationException("Terminal session has ended.");
        return new HubOperationException(await ReadErrorMessageAsync(response, cancellationToken));
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

        return "Could not queue code for execution. Please try again.";
    }
}
