using Microsoft.AspNetCore.Mvc;
using server.Application.Rooms;

namespace server.Controllers;

[ApiController]
[Route("api/rooms")]
public class RoomsController : ControllerBase
{
    private readonly CreateRoomService _createRoom;
    private readonly IRoomCreationRateLimiter _rateLimiter;

    public RoomsController(
        CreateRoomService createRoom,
        IRoomCreationRateLimiter rateLimiter)
    {
        _createRoom = createRoom;
        _rateLimiter = rateLimiter;
    }

    [HttpPost]
    public async Task<IActionResult> Create()
    {
        var clientAddress = HttpContext.Connection.RemoteIpAddress?.ToString();
        if (string.IsNullOrWhiteSpace(clientAddress) ||
            !await _rateLimiter.TryConsumeAsync(clientAddress, Guid.NewGuid().ToString("N")))
            return StatusCode(StatusCodes.Status429TooManyRequests, new { error = "rate_limited" });

        return Ok(await _createRoom.CreateAsync());
    }
}
