namespace server.Services;

public sealed class ServerInstanceIdentity
{
    public string Id { get; } = Guid.NewGuid().ToString("N");
}
