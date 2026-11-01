using System.Text;

namespace Syncode.ExecutionService.Infrastructure;

public static class ExecutionServiceStartup
{
    public static string GetRequiredApiKey(IConfiguration configuration)
    {
        var apiKey = configuration["ExecutionService:ApiKey"] ??
            Environment.GetEnvironmentVariable("SYNCODE_EXECUTION_API_KEY");
        if (string.IsNullOrWhiteSpace(apiKey))
            throw new InvalidOperationException("Set ExecutionService:ApiKey or SYNCODE_EXECUTION_API_KEY before starting the execution service.");
        if (Encoding.UTF8.GetByteCount(apiKey) < 32)
            throw new InvalidOperationException("The execution-service API key must be at least 32 bytes long.");
        return apiKey;
    }

    public static string GetRedisConnection(IConfiguration configuration, IWebHostEnvironment environment)
    {
        var connection = configuration["Redis"] ?? Environment.GetEnvironmentVariable("Redis");
        if (!string.IsNullOrWhiteSpace(connection))
        {
            if (!environment.IsDevelopment())
            {
                var password = StackExchange.Redis.ConfigurationOptions.Parse(connection).Password;
                if (password is null)
                    throw new InvalidOperationException("Configure Redis authentication before starting the execution service outside Development.");
                if (System.Text.Encoding.UTF8.GetByteCount(password) < 32)
                    throw new InvalidOperationException("The Redis password must contain at least 32 bytes outside Development.");
            }
            return connection;
        }
        if (!environment.IsDevelopment())
            throw new InvalidOperationException("Configure Redis before starting the execution service outside Development.");
        return "localhost:6379";
    }

    public static WebApplication BuildDisabledApp(WebApplicationBuilder builder)
    {
        var app = builder.Build();
        app.MapGet("/health", () => Results.Problem(
            "Execution is disabled until a hardened worker runtime is configured.",
            statusCode: StatusCodes.Status503ServiceUnavailable));
        app.MapMethods("/api/{**path}", ["GET", "POST", "PUT", "PATCH", "DELETE"], () => Results.Problem(
            "Execution is disabled until a hardened worker runtime is configured.",
            statusCode: StatusCodes.Status503ServiceUnavailable));
        return app;
    }
}
