using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.SignalR;

namespace server.Services;

public sealed class ExecutionServiceClient(HttpClient httpClient, IConfiguration configuration)
{
    public async Task<ExecutionSubmissionResult> SubmitAsync(
        string roomId,
        string requestedBy,
        string language,
        string source,
        string requestId,
        CancellationToken cancellationToken)
    {
        var baseUrl = configuration["ExecutionService:BaseUrl"];
        var apiKey = configuration["ExecutionService:ApiKey"];
        if (!Uri.TryCreate(baseUrl, UriKind.Absolute, out var serviceUri) ||
            string.IsNullOrWhiteSpace(apiKey))
        {
            throw new HubException("Code execution is not configured on this server.");
        }

        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            new Uri(new Uri(serviceUri.ToString().TrimEnd('/') + "/"), "api/executions"));
        request.Headers.TryAddWithoutValidation("X-Execution-Service-Key", apiKey);
        request.Content = JsonContent.Create(new
        {
            roomId,
            requestedBy,
            language,
            source,
            requestId,
        });

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
            throw new HubException("The code execution service is unavailable.");
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            throw new HubException("The code execution service did not respond in time.");
        }

        using (response)
        {
            if (response.StatusCode == HttpStatusCode.Accepted)
            {
                var result = await response.Content.ReadFromJsonAsync<ExecutionSubmissionResult>(cancellationToken);
                return result ?? throw new HubException("The execution service returned an invalid response.");
            }

            var message = await ReadErrorMessageAsync(response, cancellationToken);
            if (response.StatusCode == HttpStatusCode.TooManyRequests &&
                response.Headers.RetryAfter?.Delta is { } retryAfter)
            {
                message = $"Execution rate limit reached. Try again in {Math.Max(1, (int)Math.Ceiling(retryAfter.TotalSeconds))} seconds.";
            }
            throw new HubException(message);
        }
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

public sealed record ExecutionSubmissionResult(string JobId, int QueuePosition);

public sealed record ExecutionOutputEvent(
    string RoomId,
    string JobId,
    string RequestId,
    string Type,
    string? Stream = null,
    string? Text = null,
    int? ExitCode = null,
    bool? TimedOut = null,
    bool? OutputLimitExceeded = null);
