using System.Diagnostics;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

internal sealed class ExecutionLoadScenario(LoadOptions options)
{
    private sealed record StartResponse(string SessionId);
    private sealed record OutputResponse(string Text, int Offset, bool Exited, int? ExitCode);
    private sealed record JobResult(double StartMs, double RunMs, double DurationSeconds, bool Verified, bool Cleaned, string? Error);

    public async Task<ExecutionLoadResult> RunAsync(CancellationToken cancellationToken)
    {
        var stopwatch = Stopwatch.StartNew();
        using var client = new HttpClient { BaseAddress = options.ExecutionBaseUrl, Timeout = TimeSpan.FromSeconds(15) };
        client.DefaultRequestHeaders.Add("X-Execution-Service-Key", options.ExecutionApiKey);
        var healthCheck = Stopwatch.StartNew();
        using (var healthResponse = await client.GetAsync("health", cancellationToken))
        {
            healthResponse.EnsureSuccessStatusCode();
            healthCheck.Stop();
        }
        var roomIds = Enumerable.Range(0, (options.ExecutionJobs + 3) / 4)
            .Select(_ => $"load-execution-{Guid.NewGuid():N}")
            .ToArray();
        JobResult[] jobs;
        try
        {
            jobs = await Task.WhenAll(Enumerable.Range(1, options.ExecutionJobs)
                .Select(index => RunJobAsync(client, roomIds[(index - 1) / 4], index, cancellationToken)));
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            jobs = [];
        }
        var packageFailureHandled = !cancellationToken.IsCancellationRequested &&
            await CheckPackageInstallFailureAsync(client, $"load-package-{Guid.NewGuid():N}", cancellationToken);
        var interruptionVerified = options.WorkerInterruptionCheckpoint &&
            await CheckWorkerInterruptionAsync(client, $"load-interruption-{Guid.NewGuid():N}", cancellationToken);
        stopwatch.Stop();
        var errors = jobs.Where(job => job.Error is not null).Select(job => job.Error!).ToArray();
        return new ExecutionLoadResult(
            options.ExecutionJobs,
            jobs.Count(job => job.Verified),
            healthCheck.Elapsed.TotalMilliseconds,
            Percentile(jobs.Select(job => job.StartMs), .95),
            Percentile(jobs.Select(job => job.RunMs), .95),
            stopwatch.Elapsed.TotalSeconds,
            jobs.All(job => job.Verified),
            jobs.All(job => job.Cleaned),
            packageFailureHandled,
            interruptionVerified,
            errors);
    }

    private static async Task<bool> CheckPackageInstallFailureAsync(
        HttpClient client,
        string roomId,
        CancellationToken cancellationToken)
    {
        string? sessionId = null;
        try
        {
            using var startResponse = await client.PostAsJsonAsync(
                "api/terminals", new { roomId, entries = Array.Empty<object>() }, cancellationToken);
            startResponse.EnsureSuccessStatusCode();
            var start = await startResponse.Content.ReadFromJsonAsync<StartResponse>(cancellationToken: cancellationToken)
                ?? throw new InvalidOperationException("Execution service returned an invalid session.");
            sessionId = start.SessionId;
            var marker = $"SYNCODE_PACKAGE_FAILURE_{Guid.NewGuid():N}";
            var package = $"syncode-load-package-{Guid.NewGuid():N}";
            var input = $"npm install --offline --no-audit --no-fund --no-save --package-lock=false {package}\nstatus=$?\nprintf '\\n{marker}:%s\\n' \"$status\"\n";
            using var inputResponse = await client.PostAsJsonAsync(
                $"api/terminals/{sessionId}/input", new { input }, cancellationToken);
            inputResponse.EnsureSuccessStatusCode();

            var offset = 0;
            var outputText = new StringBuilder();
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(TimeSpan.FromSeconds(30));
            while (true)
            {
                using var response = await client.GetAsync($"api/terminals/{sessionId}/output?offset={offset}", timeout.Token);
                response.EnsureSuccessStatusCode();
                var output = await response.Content.ReadFromJsonAsync<OutputResponse>(cancellationToken: timeout.Token)
                    ?? throw new InvalidOperationException("Execution service returned invalid output.");
                offset = output.Offset;
                outputText.Append(output.Text);
                var markerPosition = outputText.ToString().LastIndexOf(marker, StringComparison.Ordinal);
                if (markerPosition >= 0)
                {
                    var statusText = outputText.ToString()[(markerPosition + marker.Length)..].TrimStart(' ', ':', '\r', '\n');
                    var status = new string(statusText.TakeWhile(char.IsAsciiDigit).ToArray());
                    return int.TryParse(status, out var exitCode) && exitCode != 0 &&
                        outputText.ToString().Contains("npm", StringComparison.OrdinalIgnoreCase);
                }
                await Task.Delay(100, timeout.Token);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception) when (exception is HttpRequestException or InvalidOperationException or JsonException or TaskCanceledException)
        {
            return false;
        }
        finally
        {
            if (sessionId is not null)
            {
                try { using var _ = await client.DeleteAsync($"api/terminals/{sessionId}", CancellationToken.None); }
                catch (HttpRequestException) { }
                catch (TaskCanceledException) { }
            }
        }
    }

    private static async Task<bool> CheckWorkerInterruptionAsync(
        HttpClient client,
        string roomId,
        CancellationToken cancellationToken)
    {
        string? sessionId = null;
        try
        {
            var sourcePath = "load-interruption.js";
            var marker = $"syncode-load-running-{Guid.NewGuid():N}";
            var entries = new[]
            {
                new { path = sourcePath, isFolder = false, content = $"setInterval(() => console.log('{marker}'), 1000);" }
            };
            using var startResponse = await client.PostAsJsonAsync(
                "api/terminals", new { roomId, entries }, cancellationToken);
            startResponse.EnsureSuccessStatusCode();
            var start = await startResponse.Content.ReadFromJsonAsync<StartResponse>(cancellationToken: cancellationToken)
                ?? throw new InvalidOperationException("Execution service returned an invalid session.");
            sessionId = start.SessionId;
            using var runResponse = await client.PostAsJsonAsync(
                $"api/terminals/{sessionId}/run", new { language = "javascript", sourcePath, entries }, cancellationToken);
            runResponse.EnsureSuccessStatusCode();
            await WaitForMarkerAsync(client, sessionId, marker, cancellationToken);

            Console.WriteLine("A long-running isolated terminal is active. In another PowerShell window run `docker compose --env-file infra/.env -f infra/docker-compose.local.yml restart execution-service`, wait for it to return, then press Enter here.");
            await Console.In.ReadLineAsync(cancellationToken);

            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(TimeSpan.FromMinutes(3));
            while (true)
            {
                timeout.Token.ThrowIfCancellationRequested();
                try
                {
                    using var health = await client.GetAsync("health", timeout.Token);
                    if (health.IsSuccessStatusCode)
                    {
                        using var output = await client.GetAsync($"api/terminals/{sessionId}/output?offset=0", timeout.Token);
                        if (output.StatusCode == System.Net.HttpStatusCode.NotFound) return true;
                    }
                }
                catch (HttpRequestException) { }
                await Task.Delay(500, timeout.Token);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception) when (exception is HttpRequestException or InvalidOperationException or JsonException or TaskCanceledException)
        {
            return false;
        }
        finally
        {
            if (sessionId is not null)
            {
                try { using var _ = await client.DeleteAsync($"api/terminals/{sessionId}", CancellationToken.None); }
                catch (HttpRequestException) { }
            }
        }
    }

    private static async Task WaitForMarkerAsync(
        HttpClient client,
        string sessionId,
        string marker,
        CancellationToken cancellationToken)
    {
        var offset = 0;
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(30));
        while (true)
        {
            using var response = await client.GetAsync($"api/terminals/{sessionId}/output?offset={offset}", timeout.Token);
            response.EnsureSuccessStatusCode();
            var output = await response.Content.ReadFromJsonAsync<OutputResponse>(cancellationToken: timeout.Token)
                ?? throw new InvalidOperationException("Execution service returned invalid output.");
            offset = output.Offset;
            if (output.Text.Contains(marker, StringComparison.Ordinal)) return;
            if (output.Exited) throw new InvalidOperationException("The long-running terminal stopped before the worker restart.");
            await Task.Delay(100, timeout.Token);
        }
    }

    private static async Task<JobResult> RunJobAsync(
        HttpClient client,
        string roomId,
        int index,
        CancellationToken cancellationToken)
    {
        string? sessionId = null;
        var startTimer = Stopwatch.StartNew();
        var runTimer = Stopwatch.StartNew();
        var jobTimer = Stopwatch.StartNew();
        var cleaned = false;
        var verified = false;
        string? error = null;
        var marker = $"syncode-load-execution-{Guid.NewGuid():N}";
        var sourcePath = $"load-{index}.js";
        var entries = new[]
        {
            new { path = sourcePath, isFolder = false, content = $"console.log('{marker}');" }
        };
        try
        {
            using var startResponse = await client.PostAsJsonAsync(
                "api/terminals", new { roomId, entries }, cancellationToken);
            startResponse.EnsureSuccessStatusCode();
            var start = await startResponse.Content.ReadFromJsonAsync<StartResponse>(cancellationToken: cancellationToken)
                ?? throw new InvalidOperationException("Execution service returned an invalid session.");
            sessionId = start.SessionId;
            startTimer.Stop();

            runTimer.Restart();
            using var runResponse = await client.PostAsJsonAsync(
                $"api/terminals/{sessionId}/run",
                new { language = "javascript", sourcePath, entries },
                cancellationToken);
            runResponse.EnsureSuccessStatusCode();
            runTimer.Stop();

            verified = await ReadUntilCompleteAsync(client, sessionId, marker, cancellationToken);
            if (!verified) error = "Execution output did not match the expected marker.";
            using (var deleteResponse = await client.DeleteAsync($"api/terminals/{sessionId}", cancellationToken))
                deleteResponse.EnsureSuccessStatusCode();
            using (var afterDelete = await client.GetAsync($"api/terminals/{sessionId}/output?offset=0", cancellationToken))
                cleaned = afterDelete.StatusCode == System.Net.HttpStatusCode.NotFound;
            jobTimer.Stop();
            if (!cleaned) error = "Execution session remained available after cleanup.";
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception) when (exception is HttpRequestException or InvalidOperationException or JsonException or TaskCanceledException)
        {
            error = exception.GetType().Name;
        }
        finally
        {
            if (sessionId is not null && !cleaned)
            {
                try
                {
                    using var response = await client.DeleteAsync($"api/terminals/{sessionId}", CancellationToken.None);
                    cleaned = response.IsSuccessStatusCode || response.StatusCode == System.Net.HttpStatusCode.NotFound;
                }
                catch (HttpRequestException) { }
            }
        }
        jobTimer.Stop();
        return new JobResult(startTimer.Elapsed.TotalMilliseconds, runTimer.Elapsed.TotalMilliseconds,
            jobTimer.Elapsed.TotalSeconds, verified, cleaned, error);
    }

    private static async Task<bool> ReadUntilCompleteAsync(
        HttpClient client,
        string sessionId,
        string marker,
        CancellationToken cancellationToken)
    {
        var offset = 0;
        var collected = new StringBuilder();
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(30));
        while (true)
        {
            using var response = await client.GetAsync($"api/terminals/{sessionId}/output?offset={offset}", timeout.Token);
            response.EnsureSuccessStatusCode();
            var output = await response.Content.ReadFromJsonAsync<OutputResponse>(cancellationToken: timeout.Token)
                ?? throw new InvalidOperationException("Execution service returned invalid output.");
            offset = output.Offset;
            collected.Append(output.Text);
            if (output.Exited) return output.ExitCode == 0 && collected.ToString().Contains(marker, StringComparison.Ordinal);
            await Task.Delay(100, timeout.Token);
        }
    }

    private static double Percentile(IEnumerable<double> values, double percentile)
    {
        var ordered = values.Order().ToArray();
        if (ordered.Length == 0) return 0;
        return ordered[Math.Clamp((int)Math.Ceiling(ordered.Length * percentile) - 1, 0, ordered.Length - 1)];
    }
}
