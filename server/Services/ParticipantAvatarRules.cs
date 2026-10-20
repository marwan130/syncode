namespace server.Services;

internal static class ParticipantAvatarRules
{
    internal static string? Normalize(string? value)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > 512 ||
            !Uri.TryCreate(value, UriKind.Absolute, out var avatarUri) ||
            avatarUri.Scheme != Uri.UriSchemeHttps ||
            !avatarUri.IsDefaultPort ||
            !string.Equals(avatarUri.Host, "avatars.githubusercontent.com", StringComparison.OrdinalIgnoreCase) ||
            !string.IsNullOrEmpty(avatarUri.UserInfo))
            return null;

        return avatarUri.AbsoluteUri;
    }
}
