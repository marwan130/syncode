using server.Application.Rooms;

namespace server.Application.Projects;

public static class ProjectRootName
{
    public static string Normalize(string? value)
    {
        var name = value?.Trim() ?? string.Empty;
        if (name.Length is < 1 or > 128 || name.Any(char.IsControl) ||
            name.IndexOfAny(['/', '\\', ':', '*', '?', '"', '<', '>', '|']) >= 0)
            throw new RoomOperationException("The project name is invalid.");
        return name;
    }
}
