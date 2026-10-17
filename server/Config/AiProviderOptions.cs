namespace server.Config;

public sealed class AiProviderOptions
{
    public const string SectionName = "AiProvider";

    public bool Enabled { get; set; }
    public string Provider { get; set; } = string.Empty;
    public string Model { get; set; } = string.Empty;
    public string ApiKey { get; set; } = string.Empty;
    public int MaxRequestCharacters { get; set; } = 32_000;
    public int MaxResponseCharacters { get; set; } = 16_000;
    public int RequestsPerMinutePerConnection { get; set; } = 5;
    public int RequestsPerMinutePerRoom { get; set; } = 20;
    public long DailyUsageBudget { get; set; }
}
