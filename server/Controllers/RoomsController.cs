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
        var accessKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');
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
