using Microsoft.AspNetCore.SignalR;
using server.Services;

namespace server.Hubs;

public sealed class SignalRRoomEventPublisher(IHubContext<CollabHub> hub) : IRoomEventPublisher
{
    public Task SendToRoomAsync(
        string roomId,
        string eventName,
        object payload,
        CancellationToken cancellationToken) =>
        hub.Clients.Group(roomId).SendAsync(eventName, payload, cancellationToken);
}
