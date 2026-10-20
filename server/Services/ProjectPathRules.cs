namespace server.Services;

public static class ProjectPathRules
{
    public static string NormalizeName(string? value)
    {
        var name = value?.Trim() ?? string.Empty;
        return name.Length is < 1 or > 128 || name is "." or ".." ||
            name.IndexOfAny([ '/', '\\', ':', '*', '?', '"', '<', '>', '|' ]) >= 0 ||
            name.Any(char.IsControl) ? string.Empty : name;
    }

    public static bool IsSafePath(string? path)
    {
        if (string.IsNullOrWhiteSpace(path) || path.Length > 512 || path.StartsWith('/') ||
            path.Contains('\\') || path.Any(char.IsControl)) return false;
        return path.Split('/').All(segment => segment.Length > 0 && segment is not "." and not ".." &&
            segment.IndexOfAny([ ':', '*', '?', '"', '<', '>', '|' ]) < 0);
    }

    public static bool IsSafeIdentifier(string value) =>
        value.Length is > 0 and <= 128 && value is not "." and not ".." &&
        value.All(character => char.IsAsciiLetterOrDigit(character) || character is '-' or '_' or '.');
}
