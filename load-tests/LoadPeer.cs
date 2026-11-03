using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text.Json;
using Microsoft.AspNetCore.SignalR.Client;

internal sealed class LoadPeer : IAsyncDisposable
{
    private readonly ConcurrentDictionary<string, CrdtOperation> _received = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, byte> _receivedLive = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, byte> _receivedChat = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, byte> _receivedAwareness = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, byte> _receivedTree = new(StringComparer.Ordinal);
    private readonly ConcurrentDictionary<string, byte> _sentTree = new(StringComparer.Ordinal);
    private TaskCompletionSource _allOperationsReceived = NewSignal();
    private TaskCompletionSource _snapshotReceived = NewSignal();
    private int _expected;
    private int _receivedCount;
    private int _duplicates;
    private int _unexpectedRoomEvents;
    private int _duplicateRoomEvents;
    private TaskCompletionSource _chatReceived = NewSignal();
    private TaskCompletionSource _awarenessReceived = NewSignal();
    private TaskCompletionSource _treeReceived = NewSignal();
    private int _chatExpected;
    private int _awarenessExpected;
    private int _treeExpected;
    private int _chatCount;
    private int _awarenessCount;
    private int _treeCount;
    private string? _recoveredSnapshot;
    private string? _expectedFileId;

    public LoadPeer(
        string siteId,
        HubConnection connection,
        RoomInvitation invitation,
        string roomPrefix,
        string importSiteId,
        ConcurrentDictionary<string, long> sentAt,
        ConcurrentQueue<double> propagationLatencies)
    {
        SiteId = siteId;
        Connection = connection;
        Invitation = invitation;
        RoomPrefix = roomPrefix;
        ImportSiteId = importSiteId;
        SentAt = sentAt;
        Connection.On("RoomJoinApproved", () => Approval.TrySetResult());
        Connection.On<string, JsonElement>("ReceiveFileOp", (fileId, raw) => OnOperation(fileId, raw, propagationLatencies));
        Connection.On<JsonElement>("ChatMessage", OnChatMessage);
        Connection.On<string, JsonElement>("AwarenessUpdate", OnAwarenessUpdate);
        Connection.On<JsonElement>("ProjectTreeOperation", OnProjectTreeOperation);
        Connection.On<string, string>("LoadFileSnapshot", (fileId, snapshot) =>
        {
            if (_expectedFileId is not null && fileId != _expectedFileId)
            {
                Interlocked.Increment(ref _unexpectedRoomEvents);
                return;
            }
            _recoveredSnapshot = snapshot;
            Volatile.Read(ref _snapshotReceived).TrySetResult();
        });
    }

    public string SiteId { get; }
    public HubConnection Connection { get; }
    public RoomInvitation Invitation { get; }
    public string RoomPrefix { get; }
    public string ImportSiteId { get; }
    public string RequestId { get; } = Guid.NewGuid().ToString("N");
    public TaskCompletionSource Approval { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
    public ConcurrentDictionary<string, long> SentAt { get; }
    public List<TimedOperation> SentOperations { get; } = [];
    public IReadOnlyDictionary<string, CrdtOperation> ReceivedOperations => _received;
    public int LiveReceivedOperationCount => _receivedLive.Count;
    public IReadOnlySet<string> KnownTreeOperations => _receivedTree.Keys.Concat(_sentTree.Keys).ToHashSet(StringComparer.Ordinal);
    public int DuplicateOperations => _duplicates;
    public int UnexpectedRoomEvents => _unexpectedRoomEvents;
    public int DuplicateRoomEvents => _duplicateRoomEvents;
    public bool Joined { get; set; }

    public void ExpectFile(string fileId) => _expectedFileId = fileId;

    public void ExpectReceivedOperations(int count)
    {
        Interlocked.Exchange(ref _allOperationsReceived, NewSignal());
        Volatile.Write(ref _receivedCount, 0);
        Volatile.Write(ref _expected, count);
        if (count == 0) Volatile.Read(ref _allOperationsReceived).TrySetResult();
    }

    public Task WaitForExpectedOperationsAsync(TimeSpan timeout, CancellationToken cancellationToken) =>
        Volatile.Read(ref _allOperationsReceived).Task.WaitAsync(timeout, cancellationToken);

    public void ClearSnapshotSignal()
    {
        _recoveredSnapshot = null;
        Interlocked.Exchange(ref _snapshotReceived, NewSignal());
    }

    public Task WaitForSnapshotAsync(TimeSpan timeout, CancellationToken cancellationToken) =>
        Volatile.Read(ref _snapshotReceived).Task.WaitAsync(timeout, cancellationToken);

    public void ExpectChatEvents(int count)
    {
        _receivedChat.Clear();
        ResetWait(ref _chatReceived, ref _chatCount, ref _chatExpected, count);
    }

    public void ExpectAwarenessEvents(int count)
    {
        _receivedAwareness.Clear();
        ResetWait(ref _awarenessReceived, ref _awarenessCount, ref _awarenessExpected, count);
    }

    public void ExpectTreeEvents(int count)
    {
        _receivedTree.Clear();
        ResetWait(ref _treeReceived, ref _treeCount, ref _treeExpected, count);
    }

    public void RecordSentTreeOperation(JsonElement operation)
    {
        var id = operation.GetProperty("opId");
        var key = $"{id.GetProperty("siteId").GetString()}:{id.GetProperty("counter").GetInt64()}";
        _sentTree.TryAdd(key, 0);
    }
    public Task WaitForChatAsync(TimeSpan timeout, CancellationToken token) => Volatile.Read(ref _chatReceived).Task.WaitAsync(timeout, token);
    public Task WaitForAwarenessAsync(TimeSpan timeout, CancellationToken token) => Volatile.Read(ref _awarenessReceived).Task.WaitAsync(timeout, token);
    public Task WaitForTreeAsync(TimeSpan timeout, CancellationToken token) => Volatile.Read(ref _treeReceived).Task.WaitAsync(timeout, token);

    public string ReadRecoveredSnapshot() => new CrdtReplicaSnapshot(_recoveredSnapshot ?? "{}").GetVisibleText();
    public void SeedRecoveredSnapshot()
    {
        foreach (var operation in new CrdtReplicaSnapshot(_recoveredSnapshot ?? "{}").ReadOperations())
            _received.TryAdd(operation.Key, operation);
    }
    public ValueTask DisposeAsync() => Connection.DisposeAsync();

    private void OnOperation(string fileId, JsonElement raw, ConcurrentQueue<double> propagationLatencies)
    {
        if (_expectedFileId is not null && fileId != _expectedFileId)
        {
            Interlocked.Increment(ref _unexpectedRoomEvents);
            return;
        }
        var operation = CrdtOperation.Parse(raw);
        if (operation.SiteId is null || !operation.SiteId.StartsWith(RoomPrefix, StringComparison.Ordinal))
        {
            Interlocked.Increment(ref _unexpectedRoomEvents);
            return;
        }
        if (!_received.TryAdd(operation.Key, operation)) Interlocked.Increment(ref _duplicates);
        else _receivedLive.TryAdd(operation.Key, 0);
        if (SentAt.TryGetValue(operation.Key, out var sent))
            propagationLatencies.Enqueue(Stopwatch.GetElapsedTime(sent).TotalMilliseconds);
        if (Interlocked.Increment(ref _receivedCount) >= Volatile.Read(ref _expected))
            Volatile.Read(ref _allOperationsReceived).TrySetResult();
    }

    private void OnChatMessage(JsonElement message)
    {
        if (!message.TryGetProperty("content", out var content) || content.ValueKind != JsonValueKind.String) return;
        if (!content.GetString()!.StartsWith(RoomPrefix, StringComparison.Ordinal))
        {
            Interlocked.Increment(ref _unexpectedRoomEvents);
            return;
        }
        if (!_receivedChat.TryAdd(content.GetString()!, 0))
        {
            Interlocked.Increment(ref _duplicateRoomEvents);
            return;
        }
        if (Interlocked.Increment(ref _chatCount) >= Volatile.Read(ref _chatExpected))
            Volatile.Read(ref _chatReceived).TrySetResult();
    }

    private void OnAwarenessUpdate(string _, JsonElement awareness)
    {
        if (!awareness.TryGetProperty("probe", out var probe) || probe.ValueKind != JsonValueKind.String ||
            !probe.GetString()!.StartsWith(RoomPrefix, StringComparison.Ordinal))
        {
            Interlocked.Increment(ref _unexpectedRoomEvents);
            return;
        }
        if (!_receivedAwareness.TryAdd(probe.GetString()!, 0))
        {
            Interlocked.Increment(ref _duplicateRoomEvents);
            return;
        }
        if (Interlocked.Increment(ref _awarenessCount) >= Volatile.Read(ref _awarenessExpected))
            Volatile.Read(ref _awarenessReceived).TrySetResult();
    }

    private void OnProjectTreeOperation(JsonElement operation)
    {
        if (!operation.TryGetProperty("opId", out var opId) ||
            !opId.TryGetProperty("siteId", out var siteId) || siteId.ValueKind != JsonValueKind.String ||
            !(siteId.GetString()!.StartsWith(RoomPrefix, StringComparison.Ordinal) ||
              siteId.GetString() == ImportSiteId))
        {
            Interlocked.Increment(ref _unexpectedRoomEvents);
            return;
        }
        var operationId = $"{siteId.GetString()}:{opId.GetProperty("counter").GetInt64()}";
        if (!_receivedTree.TryAdd(operationId, 0))
        {
            Interlocked.Increment(ref _duplicateRoomEvents);
            return;
        }
        if (Interlocked.Increment(ref _treeCount) >= Volatile.Read(ref _treeExpected))
            Volatile.Read(ref _treeReceived).TrySetResult();
    }

    private static void ResetWait(ref TaskCompletionSource signal, ref int actual, ref int expected, int count)
    {
        Interlocked.Exchange(ref signal, NewSignal());
        Volatile.Write(ref actual, 0);
        Volatile.Write(ref expected, count);
        if (count == 0) Volatile.Read(ref signal).TrySetResult();
    }

    private static TaskCompletionSource NewSignal() => new(TaskCreationOptions.RunContinuationsAsynchronously);
}
