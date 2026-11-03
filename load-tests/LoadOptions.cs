internal sealed class LoadOptions
{
    public required Uri BaseUrl { get; init; }
    public int Participants { get; init; }
    public int Rooms { get; init; }
    public int OperationsPerParticipant { get; init; }
    public int SoakSeconds { get; init; }
    public int TimeoutSeconds { get; init; }
    public bool CheckReconnect { get; init; }
    public bool RestartCheckpoint { get; init; }
    public bool ExpiryRecovery { get; init; }
    public int ExpiryWaitSeconds { get; init; }
    public bool RunExecution { get; init; }
    public bool WorkerInterruptionCheckpoint { get; init; }
    public Uri ExecutionBaseUrl { get; init; } = new("http://127.0.0.1:5112/");
    public string? ExecutionApiKey { get; init; }
    public int ExecutionJobs { get; init; }
    public bool CollectDockerMetrics { get; init; }
    public string Environment { get; init; } = "local";
    public string ServerSpecifications { get; init; } = "unspecified";
    public string ResultsDirectory { get; init; } = "load-tests/results";

    public static LoadOptions Parse(string[] args)
    {
        var (values, flags) = ParseArguments(args);
        var baseUrl = ParseBaseUrl(values, flags);
        var workload = ParseWorkload(values, flags);
        var execution = ParseExecution(values, flags, baseUrl);
        if (flags.Contains("--restart-checkpoint") && flags.Contains("--expiry-recovery"))
            throw new ArgumentException("Choose one room recovery checkpoint per run.");
        if (flags.Contains("--worker-interruption") && !execution.Enabled)
            throw new ArgumentException("Use --worker-interruption together with --execution.");
        if (flags.Contains("--docker-metrics") && !baseUrl.IsLoopback)
            throw new ArgumentException("Docker metrics can only be collected for the local environment.");

        return new LoadOptions
        {
            BaseUrl = baseUrl,
            Rooms = workload.Rooms,
            Participants = workload.Participants,
            OperationsPerParticipant = workload.Operations,
            SoakSeconds = workload.SoakSeconds,
            TimeoutSeconds = ReadInt(values, "--timeout-seconds", 30, 5, 300),
            CheckReconnect = flags.Contains("--reconnect"),
            RestartCheckpoint = flags.Contains("--restart-checkpoint"),
            ExpiryRecovery = flags.Contains("--expiry-recovery"),
            ExpiryWaitSeconds = ReadInt(values, "--expiry-wait-seconds", 130, 125, 1800),
            RunExecution = execution.Enabled,
            WorkerInterruptionCheckpoint = flags.Contains("--worker-interruption"),
            ExecutionBaseUrl = execution.BaseUrl,
            ExecutionApiKey = execution.ApiKey,
            ExecutionJobs = execution.Jobs,
            CollectDockerMetrics = flags.Contains("--docker-metrics"),
            Environment = values.GetValueOrDefault("--environment") ?? System.Environment.GetEnvironmentVariable("SYNCODE_LOAD_ENVIRONMENT") ?? "local",
            ServerSpecifications = values.GetValueOrDefault("--server-specs") ?? System.Environment.GetEnvironmentVariable("SYNCODE_LOAD_SERVER_SPECS") ?? "unspecified",
            ResultsDirectory = values.GetValueOrDefault("--results-dir") ?? "load-tests/results"
        };
    }

    private static (Dictionary<string, string?> Values, HashSet<string> Flags) ParseArguments(string[] args)
    {
        var values = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
        var flags = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        for (var index = 0; index < args.Length; index++)
        {
            var key = args[index];
            if (!key.StartsWith("--", StringComparison.Ordinal))
                throw new ArgumentException("Use named options such as --participants 5.");
            if (IsFlag(key)) { flags.Add(key); continue; }
            if (++index >= args.Length) throw new ArgumentException($"Missing value for {key}.");
            values[key] = args[index];
        }
        return (values, flags);
    }

    private static bool IsFlag(string key) => key is
        "--reconnect" or "--restart-checkpoint" or "--expiry-recovery" or "--allow-remote" or "--execution" or "--worker-interruption" or "--docker-metrics";

    private static Uri ParseBaseUrl(IReadOnlyDictionary<string, string?> values, ISet<string> flags)
    {
        var value = values.GetValueOrDefault("--base-url") ??
            System.Environment.GetEnvironmentVariable("SYNCODE_LOAD_BASE_URL") ?? "http://127.0.0.1:8081/";
        if (!Uri.TryCreate(value, UriKind.Absolute, out var url) ||
            url.Scheme is not ("http" or "https") || !url.AbsolutePath.EndsWith('/'))
            throw new ArgumentException("Base URL must be an HTTP(S) origin with a trailing slash.");
        if (!url.IsLoopback && !flags.Contains("--allow-remote"))
            throw new ArgumentException("Remote targets require the explicit --allow-remote option.");
        if (!url.IsLoopback && url.Scheme != "https")
            throw new ArgumentException("Remote targets must use HTTPS.");
        if (url.UserInfo.Length > 0 || url.Query.Length > 0 || url.Fragment.Length > 0)
            throw new ArgumentException("Target URLs cannot contain credentials, queries, or fragments.");
        if ((flags.Contains("--restart-checkpoint") || flags.Contains("--expiry-recovery")) && !url.IsLoopback)
            throw new ArgumentException("Room recovery checks are available only for local environments.");
        return url;
    }

    private static (int Participants, int Rooms, int Operations, int SoakSeconds) ParseWorkload(
        IReadOnlyDictionary<string, string?> values,
        ISet<string> flags)
    {
        var participants = ReadInt(values, "--participants", 2, 2, 100);
        var rooms = ReadInt(values, "--rooms", 1, 1, 10);
        if ((flags.Contains("--restart-checkpoint") || flags.Contains("--expiry-recovery")) && rooms != 1)
            throw new ArgumentException("Room recovery checks require --rooms 1.");
        if ((long)participants * rooms > 100)
            throw new ArgumentException("The combined room workload is limited to 100 participants.");
        var operations = ReadInt(values, "--operations", 10, 1, 1000);
        var soakSeconds = ReadInt(values, "--soak-seconds", 0, 0, 3600);
        var deliveryBudget = (long)participants * (participants - 1) * (operations + soakSeconds + 1) * rooms;
        if (deliveryBudget > 1_000_000)
            throw new ArgumentException("This run would exceed one million operation deliveries. Reduce participants, operations, or soak duration.");
        return (participants, rooms, operations, soakSeconds);
    }

    private static (bool Enabled, Uri BaseUrl, string? ApiKey, int Jobs) ParseExecution(
        IReadOnlyDictionary<string, string?> values,
        ISet<string> flags,
        Uri roomServerUrl)
    {
        var enabled = flags.Contains("--execution");
        var value = values.GetValueOrDefault("--execution-url") ?? "http://127.0.0.1:5112/";
        if (!Uri.TryCreate(value, UriKind.Absolute, out var url) ||
            url.Scheme is not ("http" or "https") || !url.AbsolutePath.EndsWith('/') ||
            enabled && (!url.IsLoopback || !roomServerUrl.IsLoopback) ||
            url.UserInfo.Length > 0 || url.Query.Length > 0 || url.Fragment.Length > 0)
            throw new ArgumentException("Execution load scenarios require loopback HTTP(S) URLs with trailing slashes.");
        var jobs = ReadInt(values, "--execution-jobs", 1, 1, 8);
        var apiKey = ReadExecutionApiKey();
        if (enabled && (string.IsNullOrWhiteSpace(apiKey) || System.Text.Encoding.UTF8.GetByteCount(apiKey) < 32))
            throw new ArgumentException("Set SYNCODE_EXECUTION_API_KEY to the local execution-service key before using --execution.");
        return (enabled, url, apiKey, jobs);
    }

    private static string? ReadExecutionApiKey()
    {
        var value = System.Environment.GetEnvironmentVariable("SYNCODE_EXECUTION_API_KEY");
        if (!string.IsNullOrWhiteSpace(value)) return value;
        try
        {
            foreach (var line in File.ReadLines(Path.Combine("infra", ".env")))
            {
                var entry = line.Trim();
                if (!entry.StartsWith("SYNCODE_EXECUTION_API_KEY=", StringComparison.Ordinal)) continue;
                value = entry["SYNCODE_EXECUTION_API_KEY=".Length..].Trim().Trim('"', '\'');
                if (!string.IsNullOrWhiteSpace(value)) return value;
            }
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
        return null;
    }

    private static int ReadInt(IReadOnlyDictionary<string, string?> values, string key, int fallback, int min, int max)
    {
        if (!values.TryGetValue(key, out var value)) return fallback;
        if (!int.TryParse(value, out var result) || result < min || result > max)
            throw new ArgumentException($"{key} must be between {min} and {max}.");
        return result;
    }
}
