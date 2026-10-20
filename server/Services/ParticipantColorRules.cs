using System.Text.RegularExpressions;

namespace server.Services;

internal static partial class ParticipantColorRules
{
    public static bool IsValid(string? color) => color is not null && ColorPattern().IsMatch(color);

    [GeneratedRegex("^#[0-9a-fA-F]{6}$", RegexOptions.CultureInvariant)]
    private static partial Regex ColorPattern();
}
