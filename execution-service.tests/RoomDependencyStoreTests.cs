using Microsoft.Extensions.Configuration;
using Syncode.ExecutionService.Runner;
using Xunit;

namespace Syncode.ExecutionService.Tests;

public sealed class RoomDependencyStoreTests
{
    [Fact]
    public void GetRoomPath_IsStableAndSeparatesRooms()
    {
        var root = Path.Combine(Path.GetTempPath(), $"syncode-dependencies-{Guid.NewGuid():N}");
        try
        {
            var store = CreateStore(root);
            var firstRoom = store.GetRoomPath("room-a");

            Assert.Equal(firstRoom, store.GetRoomPath("room-a"));
            Assert.NotEqual(firstRoom, store.GetRoomPath("room-b"));
            Assert.StartsWith(Path.GetFullPath(root) + Path.DirectorySeparatorChar, firstRoom, StringComparison.Ordinal);
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public void DeleteRoom_RemovesOnlyThatRoomStorage()
    {
        var root = Path.Combine(Path.GetTempPath(), $"syncode-dependencies-{Guid.NewGuid():N}");
        try
        {
            var store = CreateStore(root);
            var firstRoom = store.GetRoomPath("room-a");
            var secondRoom = store.GetRoomPath("room-b");
            File.WriteAllText(Path.Combine(firstRoom, "package.txt"), "first");
            File.WriteAllText(Path.Combine(secondRoom, "package.txt"), "second");

            store.DeleteRoom("room-a");

            Assert.False(Directory.Exists(firstRoom));
            Assert.Equal("second", File.ReadAllText(Path.Combine(secondRoom, "package.txt")));
        }
        finally
        {
            if (Directory.Exists(root)) Directory.Delete(root, recursive: true);
        }
    }

    private static RoomDependencyStore CreateStore(string root) =>
        new(new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ExecutionService:DependencyRoot"] = root
        }).Build());
}
