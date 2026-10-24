using System.Net.Http.Headers;
using System.Text.Json;
using server.Models;

namespace server.Services;

public sealed class GithubApiClient(IHttpClientFactory clients)
{
    private static readonly Uri ApiOrigin = new("https://api.github.com/");
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private const long MaxResponseBytes = 20 * 1024 * 1024;

    public async Task<T> GetAsync<T>(
        string path,
        string? accessToken,
        CancellationToken cancellationToken)
    {
        using var response = await SendAsync(
            HttpMethod.Get, path, accessToken, null, cancellationToken);
        return await ReadJsonAsync<T>(response, cancellationToken);
    }

    public async Task<T> PostAsync<T>(
        string path,
        string accessToken,
        object body,
        CancellationToken cancellationToken)
    {
        using var response = await SendAsync(
            HttpMethod.Post, path, accessToken, body, cancellationToken);
        return await ReadJsonAsync<T>(response, cancellationToken);
    }

    private async Task<HttpResponseMessage> SendAsync(
        HttpMethod method,
        string path,
        string? accessToken,
        object? body,
        CancellationToken cancellationToken)
    {
        if (path.StartsWith('/') || path.Contains("..", StringComparison.Ordinal))
            throw new InvalidOperationException("Invalid GitHub API path.");

        using var request = new HttpRequestMessage(method, new Uri(ApiOrigin, path));
        request.Headers.UserAgent.ParseAdd("Syncode/1.0");
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));
        request.Headers.Add("X-GitHub-Api-Version", "2022-11-28");
        if (!string.IsNullOrWhiteSpace(accessToken))
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        if (body is not null) request.Content = JsonContent.Create(body);

        var response = await clients.CreateClient("GithubOAuth")
            .SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        if (response.Content.Headers.ContentLength is > MaxResponseBytes)
        {
            response.Dispose();
            throw new GithubRepositoryException("The GitHub response is too large to import.", 413);
        }
        if (response.IsSuccessStatusCode) return response;

        var rateLimited = response.StatusCode == System.Net.HttpStatusCode.TooManyRequests ||
            response.StatusCode == System.Net.HttpStatusCode.Forbidden &&
            response.Headers.TryGetValues("X-RateLimit-Remaining", out var remaining) &&
            remaining.Contains("0", StringComparer.Ordinal);
        var status = rateLimited
            ? StatusCodes.Status429TooManyRequests
            : response.StatusCode switch
            {
                System.Net.HttpStatusCode.Unauthorized => StatusCodes.Status401Unauthorized,
                System.Net.HttpStatusCode.Forbidden => StatusCodes.Status403Forbidden,
                System.Net.HttpStatusCode.NotFound => StatusCodes.Status404NotFound,
                System.Net.HttpStatusCode.UnprocessableEntity => StatusCodes.Status409Conflict,
                _ => StatusCodes.Status502BadGateway,
            };
        response.Dispose();
        throw new GithubRepositoryException(
            status == StatusCodes.Status429TooManyRequests
                ? "GitHub is rate limiting repository requests. Try again later."
                : status == StatusCodes.Status403Forbidden
                    ? "This GitHub action needs additional repository access."
                    : status == StatusCodes.Status404NotFound
                        ? "The repository could not be found or accessed."
                        : status == StatusCodes.Status409Conflict
                            ? "The GitHub branch changed or could not be updated. Refresh the repository before pushing."
                            : "GitHub could not complete the repository request.",
            status);
    }

    private static async Task<T> ReadJsonAsync<T>(
        HttpResponseMessage response,
        CancellationToken cancellationToken)
    {
        var result = await response.Content.ReadFromJsonAsync<T>(JsonOptions, cancellationToken);
        return result ?? throw new GithubRepositoryException(
            "GitHub returned an invalid repository response.",
            StatusCodes.Status502BadGateway);
    }
}
