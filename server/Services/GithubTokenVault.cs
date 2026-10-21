using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using server.Models;
using StackExchange.Redis;

namespace server.Services;

public sealed class GithubTokenVault
{
    private const string SessionPrefix = "syncode:github-session:";
    private readonly IDatabase _database;
    private readonly byte[]? _encryptionKey;

    public GithubTokenVault(
        IConnectionMultiplexer redis,
        IConfiguration configuration)
    {
        _database = redis.GetDatabase();
        var configuredKey = configuration["Github:TokenEncryptionKey"];
        try
        {
            var key = Convert.FromBase64String(configuredKey ?? "");
            if (key.Length == 32) _encryptionKey = key;
        }
        catch (FormatException)
        {
            _encryptionKey = null;
        }
    }

    public static string CreateSessionId()
    {
        return Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');
    }

    internal async Task<GithubVaultEntry?> GetAsync(string sessionId)
    {
        var encryptionKey = RequireEncryptionKey();
        var key = GetSessionKey(sessionId);
        var stored = await _database.StringGetAsync(key);
        if (stored.IsNullOrEmpty) return null;

        try
        {
            var packed = Convert.FromBase64String(stored.ToString());
            if (packed.Length < 29) return null;
            var nonce = packed.AsSpan(0, 12);
            var tag = packed.AsSpan(12, 16);
            var ciphertext = packed.AsSpan(28);
            var plaintext = new byte[ciphertext.Length];
            try
            {
                using var aes = new AesGcm(encryptionKey, 16);
                aes.Decrypt(nonce, ciphertext, tag, plaintext, Encoding.UTF8.GetBytes(key));
                return JsonSerializer.Deserialize<GithubVaultEntry>(plaintext);
            }
            finally
            {
                CryptographicOperations.ZeroMemory(plaintext);
            }
        }
        catch (Exception exception) when (
            exception is FormatException or CryptographicException or JsonException)
        {
            await _database.KeyDeleteAsync(key);
            return null;
        }
    }

    internal async Task SetAsync(string sessionId, GithubVaultEntry entry)
    {
        var encryptionKey = RequireEncryptionKey();
        var key = GetSessionKey(sessionId);
        var ttl = entry.RefreshExpiresAt - DateTimeOffset.UtcNow;
        if (ttl <= TimeSpan.Zero)
            throw new InvalidOperationException("The GitHub session has expired.");

        var plaintext = JsonSerializer.SerializeToUtf8Bytes(entry);
        var nonce = RandomNumberGenerator.GetBytes(12);
        var ciphertext = new byte[plaintext.Length];
        var tag = new byte[16];
        using (var aes = new AesGcm(encryptionKey, 16))
            aes.Encrypt(nonce, plaintext, ciphertext, tag, Encoding.UTF8.GetBytes(key));

        var packed = new byte[nonce.Length + tag.Length + ciphertext.Length];
        nonce.CopyTo(packed, 0);
        tag.CopyTo(packed, nonce.Length);
        ciphertext.CopyTo(packed, nonce.Length + tag.Length);
        await _database.StringSetAsync(key, Convert.ToBase64String(packed), ttl);
        CryptographicOperations.ZeroMemory(plaintext);
    }

    internal async Task DeleteAsync(string sessionId)
    {
        await _database.KeyDeleteAsync(GetSessionKey(sessionId));
    }

    private byte[] RequireEncryptionKey() =>
        _encryptionKey ?? throw new GithubOAuthException(
            "GitHub token vault encryption is not configured.");

    internal static string GetSessionKey(string sessionId)
    {
        if (sessionId.Length != 43 ||
            sessionId.Any(character =>
                !char.IsAsciiLetterOrDigit(character) && character is not '-' and not '_'))
            throw new ArgumentException("Invalid GitHub session.", nameof(sessionId));

        var hash = SHA256.HashData(Encoding.ASCII.GetBytes(sessionId));
        return SessionPrefix + Convert.ToHexString(hash);
    }
}
