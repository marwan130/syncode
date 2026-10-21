namespace server.Services;

public static class AllowedOriginsConfiguration
{
    private static readonly string[] DevelopmentOrigins =
    [
        "http://localhost:5173",
        "http://localhost:5174"
    ];

    public static string[] Resolve(IConfiguration configuration, IHostEnvironment environment)
    {
        var configuredOrigins = configuration.GetSection("AllowedOrigins").Get<string[]>();
        if (configuredOrigins is { Length: > 0 }) return configuredOrigins;
        if (!environment.IsDevelopment())
            throw new InvalidOperationException("Configure AllowedOrigins before starting Syncode outside Development.");
        return DevelopmentOrigins;
    }
}
