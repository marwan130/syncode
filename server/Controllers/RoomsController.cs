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
        var accessKey = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
        var accessKeyHash = Convert.ToHexString(
            SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(accessKey)));
        await _store.CreateRoomAsync(roomId, accessKeyHash);
        return Ok(new { roomId, accessKey });
    }

    private static string GenerateRoomId()
    {
        const string chars = "abcdefghijklmnopqrstuvwxyz0123456789";
        return RandomNumberGenerator.GetString(chars, 8);
    }
}
