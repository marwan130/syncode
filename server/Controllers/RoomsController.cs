using Microsoft.AspNetCore.Mvc;
using server.Application.Rooms;

namespace server.Controllers;

[ApiController]
[Route("api/rooms")]
public class RoomsController : ControllerBase
{
    private readonly CreateRoomService _createRoom;

    public RoomsController(CreateRoomService createRoom) => _createRoom = createRoom;

    [HttpPost]
    public async Task<IActionResult> Create()
    {
        return Ok(await _createRoom.CreateAsync());
    }
}
