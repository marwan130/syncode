using System.Text;
using System.Text.RegularExpressions;
using server.Application.Projects;
using server.Application.Rooms;
using server.Models;

namespace server.Services;

internal static class GithubRepositoryRules
{
    internal const int MaxFiles = 500;
    internal const int MaxFileBytes = 64 * 1024;
    internal const int MaxProjectBytes = 1024 * 1024;

    internal static void ValidateRepositoryRequest(GithubRepositoryImportRequest request)
    {
        if (!IsValidRoomId(request.RoomId) || string.IsNullOrWhiteSpace(request.AccessKey) ||
            !Regex.IsMatch(request.Owner, "^[A-Za-z0-9-]{1,39}$") ||
            !Regex.IsMatch(request.Name, "^[A-Za-z0-9._-]{1,100}$") ||
            request.Name is "." or ".." ||
            request.Branch?.Length > 255)
            throw new GithubRepositoryException("The repository request is invalid.", 400);
    }

    internal static void ValidatePushRequest(GithubPushRequest request)
    {
        if (!IsValidRoomId(request.RoomId) || string.IsNullOrWhiteSpace(request.AccessKey) ||
            string.IsNullOrWhiteSpace(request.Message) || request.Message.Trim().Length > 200 ||
            request.Message.Any(char.IsControl) || request.Changes is null ||
            request.Changes.Count is < 1 or > MaxFiles)
            throw new GithubRepositoryException("The GitHub push request is invalid.", 400);

        var paths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var totalBytes = 0;
        foreach (var change in request.Changes)
        {
            if (!ProjectPathRules.IsSafePath(change.Path) || !paths.Add(change.Path) ||
                change.Deleted == (change.Content is not null))
                throw new GithubRepositoryException("The GitHub push request is invalid.", 400);
            if (change.Content is null) continue;
            var bytes = Encoding.UTF8.GetByteCount(change.Content);
            if (bytes > MaxFileBytes || change.Content.Contains('\0'))
                throw new GithubRepositoryException("A changed file exceeds the 64 KB limit.", 413);
            totalBytes += bytes;
            if (totalBytes > MaxProjectBytes)
                throw new GithubRepositoryException("The changes exceed the 1 MB push limit.", 413);
        }
    }

    internal static bool IsValidBranch(string? branch) =>
        !string.IsNullOrWhiteSpace(branch) && branch.Length <= 255 &&
        !branch.StartsWith('/') && !branch.EndsWith('/') &&
        !branch.Contains("..", StringComparison.Ordinal) &&
        !branch.Contains("@{", StringComparison.Ordinal) &&
        !branch.Any(character => char.IsControl(character) || character is ' ' or '~' or '^' or ':' or '?' or '*' or '[' or '\\');

    internal static bool IsSha(string? value) =>
        value is not null && Regex.IsMatch(value, "^[a-fA-F0-9]{40}$");

    internal static bool IsValidRoomId(string? roomId) =>
        roomId is { Length: 8 } && roomId.All(character =>
            character is >= 'a' and <= 'z' or >= '0' and <= '9');
}
