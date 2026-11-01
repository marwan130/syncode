namespace server.Application.Projects;

public static class ProjectEntryPaths
{
    public static string? GetPath(
        ProjectEntry entry,
        IReadOnlyDictionary<string, ProjectEntry> entries)
    {
        var segments = new List<string> { entry.Name };
        var visited = new HashSet<string>(StringComparer.Ordinal) { entry.Id };
        var parentId = entry.ParentId;
        while (parentId is not null)
        {
            if (!visited.Add(parentId) || !entries.TryGetValue(parentId, out var parent)) return null;
            segments.Add(parent.Name);
            parentId = parent.ParentId;
        }
        segments.Reverse();
        return string.Join('/', segments);
    }
}
