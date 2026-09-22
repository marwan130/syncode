using System.Security.Cryptography;
using Microsoft.AspNetCore.Mvc;
using server.Services;

namespace server.Controllers;

[ApiController]
[Route("api/rooms")]
public class RoomsController : ControllerBase
{
    private readonly RedisRoomStore _store;

    public RoomsController(RedisRoomStore store) => _store = store;

    [HttpPost]
    public async Task<IActionResult> Create()
    {
        var roomId = GenerateRoomId();
        await _store.CreateRoomAsync(roomId);
        return Ok(new { roomId });
    }

    [HttpGet("{roomId}")]
    public async Task<IActionResult> Get(string roomId)
    {
        var exists = await _store.RoomExistsAsync(roomId);
        if (!exists)
        {
            return NotFound(new { message = "Room does not exist or has expired" });
        }
        var participants = await _store.GetParticipantsAsync(roomId);
        return Ok(new { roomId, exists = true, participantCount = participants.Count });
    }

    private static string GenerateRoomId()
    {
        const string chars = "abcdefghijklmnopqrstuvwxyz0123456789";
        return RandomNumberGenerator.GetString(chars, 8);
    }
}
