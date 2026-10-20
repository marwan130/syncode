namespace server.Services;

public sealed class HubOperationException(string message) : Exception(message);
