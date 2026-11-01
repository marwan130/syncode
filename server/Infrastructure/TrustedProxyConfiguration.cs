using System.Net;
using Microsoft.AspNetCore.HttpOverrides;

namespace server.Infrastructure;

public static class TrustedProxyConfiguration
{
    public static void Configure(IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<ForwardedHeadersOptions>(options =>
        {
            options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
            options.ForwardLimit = 1;
            foreach (var proxy in configuration.GetSection("ReverseProxy:KnownProxies").Get<string[]>() ?? [])
                if (IPAddress.TryParse(proxy, out var address)) options.KnownProxies.Add(address);
        });
    }
}
