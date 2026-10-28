using System.Text;
using System.Text.RegularExpressions;
using server.Application.Rooms;

namespace server.Application.Projects;

internal static class ProjectImportValidator
{
    private const long MaxFileCompressedBytes = 1 * 1024 * 1024 + 8;
    private const long MaxFileSnapshotBytes = ImportedSnapshotValidator.MaxExpandedSnapshotBytes;
    private const long MaxProjectSnapshotBytes = 192 * 1024 * 1024;
    private const long MaxFileContentBytes = 64 * 1024;
    private const long MaxProjectContentBytes = 1024 * 1024;
    private const long MaxRecoveryProjectContentBytes = 32 * 1024 * 1024;
    private const long MaxProjectCompressedBytes = 10 * 1024 * 1024;

    internal static long Validate(
        IReadOnlyList<ProjectImportFile> files,
        GithubRepositoryBaseline? baseline,
        bool isRecoveryImport = false)
    {
        var totalStoredBytes = ValidateFiles(files, isRecoveryImport);
        ValidateRepositoryBaseline(baseline, files);
        return totalStoredBytes;
    }

    private static long ValidateFiles(
        IReadOnlyList<ProjectImportFile> files,
        bool isRecoveryImport)
    {
        long totalSnapshotBytes = 0;
        long totalContentBytes = 0;
        long totalCompressedBytes = 0;
        long totalStoredBytes = 0;
        var paths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var fileIds = new HashSet<string>(StringComparer.Ordinal);

        foreach (var file in files)
        {
            if (file is null || !ProjectPathRules.IsSharedPath(file.Path) ||
                file.Id is null || !ProjectPathRules.IsSafeIdentifier(file.Id) ||
                !fileIds.Add(file.Id) || !paths.Add(file.Path) ||
                file.CompressedSnapshot is null ||
                Encoding.UTF8.GetByteCount(file.CompressedSnapshot) > MaxFileCompressedBytes)
                throw new RoomOperationException("The folder import contains an invalid file.");

            foreach (var segment in file.Path.Split('/'))
                if (ProjectPathRules.NormalizeName(segment) != segment)
                    throw new RoomOperationException("The folder import contains an invalid path.");

            totalCompressedBytes += Encoding.UTF8.GetByteCount(file.CompressedSnapshot);
            var storedSnapshot = ImportedSnapshotValidator.StoreCompressed(file.CompressedSnapshot);
            totalStoredBytes += Encoding.UTF8.GetByteCount(storedSnapshot);
            var snapshot = ImportedSnapshotValidator.Decompress(file.CompressedSnapshot, MaxFileSnapshotBytes);
            totalSnapshotBytes += Encoding.UTF8.GetByteCount(snapshot);
            totalContentBytes += ImportedSnapshotValidator.Validate(
                snapshot,
                isRecoveryImport ? MaxFileSnapshotBytes : MaxFileContentBytes);
            if (totalCompressedBytes > MaxProjectCompressedBytes ||
                totalContentBytes > (isRecoveryImport
                    ? MaxRecoveryProjectContentBytes
                    : MaxProjectContentBytes) ||
                totalSnapshotBytes > MaxProjectSnapshotBytes)
                throw new RoomOperationException("The folder import exceeds the project size limit.");
        }

        return totalStoredBytes;
    }

    private static void ValidateRepositoryBaseline(
        GithubRepositoryBaseline? baseline,
        IReadOnlyList<ProjectImportFile> files)
    {
        if (baseline is null) return;
        if (!IsValidBaselineMetadata(baseline) ||
            !IsValidBranchName(baseline.Branch) ||
            baseline.FileBlobShas is null || baseline.FileBlobShas.Count > 500 ||
            baseline.FileLineEndings is null || baseline.FileLineEndings.Count > 500)
            throw new RoomOperationException("The repository baseline is invalid.");

        var paths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        ValidateBaselineBlobPaths(baseline.FileBlobShas, paths);
        ValidateBaselineLineEndings(baseline.FileLineEndings, paths);
        var importedPaths = files.Select(file => file.Path).ToHashSet(StringComparer.OrdinalIgnoreCase);
        if (!paths.SetEquals(importedPaths))
            throw new RoomOperationException("The repository baseline does not match the imported files.");
    }

    private static bool IsValidBaselineMetadata(GithubRepositoryBaseline baseline) =>
        baseline.Owner is not null && Regex.IsMatch(baseline.Owner, "^[A-Za-z0-9-]{1,39}$") &&
        baseline.Name is not null && Regex.IsMatch(baseline.Name, "^[A-Za-z0-9._-]{1,100}$") &&
        baseline.BaseCommitSha is not null && Regex.IsMatch(baseline.BaseCommitSha, "^[a-fA-F0-9]{40}$") &&
        baseline.BaseTreeSha is not null && Regex.IsMatch(baseline.BaseTreeSha, "^[a-fA-F0-9]{40}$");

    private static bool IsValidBranchName(string branch) =>
        !string.IsNullOrWhiteSpace(branch) && branch.Length <= 255 &&
        !branch.StartsWith('/') && !branch.EndsWith('/') &&
        !branch.Contains("..", StringComparison.Ordinal) &&
        !branch.Contains("@{", StringComparison.Ordinal) &&
        !branch.Any(character =>
            char.IsControl(character) || character is ' ' or '~' or '^' or ':' or '?' or '*' or '[' or '\\');

    private static void ValidateBaselineBlobPaths(
        IReadOnlyDictionary<string, string> blobShas,
        HashSet<string> paths)
    {
        foreach (var (path, sha) in blobShas)
            if (!ProjectPathRules.IsSafePath(path) || !paths.Add(path) ||
                !Regex.IsMatch(sha, "^[a-fA-F0-9]{40}$"))
                throw new RoomOperationException("The repository baseline is invalid.");
    }

    private static void ValidateBaselineLineEndings(
        IReadOnlyDictionary<string, string> lineEndings,
        HashSet<string> paths)
    {
        foreach (var (path, lineEnding) in lineEndings)
            if (!paths.Contains(path) || lineEnding is not ("lf" or "crlf" or "cr"))
                throw new RoomOperationException("The repository baseline is invalid.");
    }
}
