using System.Security.Cryptography;
using Microsoft.AspNetCore.Mvc;
using server.Services;

namespace server.Controllers;

[ApiController]
[Route("api/rooms")]
public class RoomsController : ControllerBase
{
    private readonly RedisRoomMetadataStore _rooms;

    public RoomsController(RedisRoomMetadataStore rooms) => _rooms = rooms;

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
        var creatorToken = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');
        var creatorTokenHash = Convert.ToHexString(
            SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(creatorToken)));
        await _rooms.CreateRoomAsync(roomId, accessKeyHash, creatorTokenHash);
        return Ok(new { roomId, accessKey, creatorToken });
    }

    private static string GenerateRoomId()
    {
        const string chars = "abcdefghijklmnopqrstuvwxyz0123456789";
        return RandomNumberGenerator.GetString(chars, 8);
    }
}
