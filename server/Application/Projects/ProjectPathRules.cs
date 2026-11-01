namespace server.Application.Projects;

public static class ProjectPathRules
{
    public const int MaximumDepth = 32;
    private static readonly HashSet<string> GeneratedDirectories = new(StringComparer.OrdinalIgnoreCase)
    {
        ".git", ".next", ".nuxt", ".venv", "__pycache__", "bin", "build", "coverage",
        "dist", "node_modules", "obj", "out", "packages", "target", "vendor", "venv"
    };

    private static readonly HashSet<string> GeneratedExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".class", ".dll", ".exe", ".o", ".obj", ".pdb", ".pyc", ".so"
    };

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
        var segments = path.Split('/');
        return segments.Length <= MaximumDepth && segments.All(segment => segment.Length > 0 && segment is not "." and not ".." &&
            segment.IndexOfAny([ ':', '*', '?', '"', '<', '>', '|' ]) < 0);
    }

    public static bool IsSharedPath(string path) =>
        IsSafePath(path) &&
        path.Split('/').All(segment => !GeneratedDirectories.Contains(segment)) &&
        !GeneratedExtensions.Contains(Path.GetExtension(path));

    public static bool IsSafeIdentifier(string value) =>
        value.Length is > 0 and <= 128 && value is not "." and not ".." &&
        value.All(character => char.IsAsciiLetterOrDigit(character) || character is '-' or '_' or '.');
}
