using Microsoft.AspNetCore.SignalR;
using server.Services;

namespace server.Hubs;

public sealed class HubOperationExceptionFilter : IHubFilter
{
    public async ValueTask<object?> InvokeMethodAsync(
        HubInvocationContext invocationContext,
        Func<HubInvocationContext, ValueTask<object?>> next)
    {
        try
        {
            return await next(invocationContext);
        }
        catch (HubOperationException exception)
        {
            throw new HubException(exception.Message);
        }
    }
}
