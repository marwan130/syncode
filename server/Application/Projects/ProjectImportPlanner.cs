using server.Application.Rooms;

namespace server.Application.Projects;

internal static class ProjectImportPlanner
{
    internal static ProjectImportPlan Build(
        IReadOnlyDictionary<string, ProjectEntry> entries,
        IReadOnlyList<ProjectImportFile> files,
        string importId)
    {
        var entriesByPath = CreatePathIndex(entries);
        var operations = new List<ProjectTreeCreateOperation>();
        var importedFiles = new List<(string CompressedSnapshot, ProjectTreeEntry Entry)>();
        var occupiedIds = entries.Keys.ToHashSet(StringComparer.Ordinal);
        var nextCounter = 0L;

        foreach (var file in files)
        {
            string? parentId = null;
            var segments = file.Path.Split('/');
            for (var index = 0; index < segments.Length; index++)
            {
                var path = string.Join('/', segments.Take(index + 1));
                var isFile = index == segments.Length - 1;
                if (entriesByPath.TryGetValue(path, out var existing))
                {
                    if (isFile || !existing.IsFolder)
                        throw new RoomOperationException("A file or folder with that path already exists.");
                    parentId = existing.Id;
                    continue;
                }

                if (entries.Count + operations.Count >= 500)
                    throw new RoomOperationException("A room can contain up to 500 files and folders.");
                var id = isFile ? file.Id : Guid.NewGuid().ToString("N");
                if (!occupiedIds.Add(id))
                    throw new RoomOperationException("The folder import contains a duplicate file identifier.");
                var entry = new ProjectTreeEntry(id, segments[index], parentId, !isFile);
                operations.Add(new ProjectTreeCreateOperation(
                    "create", new ProjectTreeOperationId($"import-{importId}", ++nextCounter), entry));
                entriesByPath.Add(path, new ProjectEntry(entry.Id, entry.Name, entry.ParentId, entry.IsFolder));
                if (isFile) importedFiles.Add((file.CompressedSnapshot, entry));
                else parentId = id;
            }
        }

        return new ProjectImportPlan(operations, importedFiles);
    }

    private static Dictionary<string, ProjectEntry> CreatePathIndex(
        IReadOnlyDictionary<string, ProjectEntry> entries)
    {
        var paths = new Dictionary<string, ProjectEntry>(StringComparer.OrdinalIgnoreCase);
        foreach (var entry in entries.Values)
        {
            var path = ProjectEntryPaths.GetPath(entry, entries);
            if (path is not null && !paths.TryAdd(path, entry))
                throw new RoomOperationException("The room contains conflicting file paths.");
        }
        return paths;
    }
}

internal sealed class ProjectImportPlan(
    List<ProjectTreeCreateOperation> operations,
    List<(string CompressedSnapshot, ProjectTreeEntry Entry)> importedFiles)
{
    internal List<ProjectTreeCreateOperation> Operations { get; } = operations;
    internal List<(string CompressedSnapshot, ProjectTreeEntry Entry)> ImportedFiles { get; } = importedFiles;
    internal int NewEntryCount => Operations.Count;
    internal List<ProjectTreeCreateOperation> ChangedOperations { get; } = [];
}
