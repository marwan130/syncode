using server.Hubs;
using server.Infrastructure;

var builder = WebApplication.CreateBuilder(args);

if (builder.Environment.IsDevelopment())
{
    var envFile = Path.Combine(builder.Environment.ContentRootPath, ".env");
    if (!File.Exists(envFile))
        envFile = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", ".env"));
    if (File.Exists(envFile))
    {
        foreach (var line in File.ReadLines(envFile))
        {
            var valueLine = line.Trim();
            if (valueLine.Length == 0 || valueLine.StartsWith('#')) continue;
            var separator = valueLine.IndexOf('=');
            if (separator < 1) continue;

            var key = valueLine[..separator].Trim();
            var value = valueLine[(separator + 1)..].Trim();
            if (value.Length >= 2 &&
                (value[0] == '"' && value[^1] == '"' || value[0] == '\'' && value[^1] == '\''))
                value = value[1..^1];

            var configurationKey = key.Replace("__", ":", StringComparison.Ordinal);
            if (string.IsNullOrWhiteSpace(builder.Configuration[configurationKey]))
                builder.Configuration[configurationKey] = value;
        }
    }
}

builder.Services.AddSyncodeServerServices(builder.Configuration, builder.Environment);

var app = builder.Build();
app.UseTrustedProxyForwarding();

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseExceptionHandler(_ => { });
if (!app.Environment.IsDevelopment())
{
    app.UseHttpsRedirection();
}
app.UseCors("client");
app.UseWebSockets();

app.MapControllers();
app.MapGet("/health", () => Results.Ok(new { status = "healthy" }));
app.MapGet("/api/language-servers", (HttpContext context, server.Services.LanguageServerSessionService languageServers) =>
    languageServers.ProxyAsync(context));
app.MapHub<CollabHub>("/collabhub");

app.Run();
