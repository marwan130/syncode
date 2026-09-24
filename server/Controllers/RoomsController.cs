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

    private static string GenerateRoomId()
    {
        const string chars = "abcdefghijklmnopqrstuvwxyz0123456789";
        return RandomNumberGenerator.GetString(chars, 8);
    }
}
