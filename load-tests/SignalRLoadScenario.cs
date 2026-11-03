using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO.Compression;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.SignalR;
using Microsoft.AspNetCore.SignalR.Client;

internal sealed class SignalRLoadScenario(LoadOptions options, int roomIndex = 1)
{
    private readonly List<LoadPeer> _peers = [];
    private readonly ConcurrentDictionary<string, long> _sentAt = new(StringComparer.Ordinal);
    private readonly ConcurrentQueue<double> _propagationLatencies = new();
    private readonly ConcurrentQueue<string> _errors = new();
    private readonly string _roomPrefix = $"load-{roomIndex:000}-";
    private HubConnection? _adminConnection;
    private RoomInvitation? _invitation;
    private LoadPeer? _lateJoiningPeer;
    private string? _importSiteId;
    private string? _documentFileId;

    public async Task<LoadReport> RunAsync(
        DateTimeOffset startedAt,
        string generatorSpecifications,
        string? commit,
        CancellationToken cancellationToken)
    {
        var stopwatch = Stopwatch.StartNew();
        var report = new LoadReport
        {
            StartedAtUtc = startedAt,
            BaseUrl = options.BaseUrl.ToString(),
            Environment = options.Environment,
            ServerSpecifications = options.ServerSpecifications,
            GeneratorSpecifications = generatorSpecifications,
            Commit = commit
        };

        try
        {
            using var http = new HttpClient { BaseAddress = options.BaseUrl, Timeout = TimeSpan.FromSeconds(15) };
            report.HealthCheckMilliseconds = await CheckHealthAsync(http, cancellationToken);
            _invitation = await CreateRoomAsync(http, report, cancellationToken);
            report.RoomId = _invitation.RoomId;
            _importSiteId = $"import-{Guid.NewGuid():N}";

            var fileId = Guid.NewGuid().ToString("N");
            _documentFileId = fileId;
            var admin = CreatePeer($"{_roomPrefix}participant-000");
            report.ConnectionLatenciesMilliseconds.Add(await StartPeerAsync(admin, cancellationToken));
            _adminConnection = admin.Connection;
            var adminJoinTimer = Stopwatch.StartNew();
            await JoinPeerAsync(admin, admin.Connection, cancellationToken);
            report.JoinLatenciesMilliseconds.Add(adminJoinTimer.Elapsed.TotalMilliseconds);
            await ImportEmptyDocumentAsync(admin.Connection, fileId, cancellationToken);

            await ConnectParticipantsAsync(report, cancellationToken);
            var replicaTexts = await RunConcurrentEditsAsync(fileId, report, cancellationToken);
            await SaveSnapshotAsync(fileId, cancellationToken);
            report.SnapshotPersisted = true;
            await JoinLateParticipantAsync(report, replicaTexts, cancellationToken);
            await RunSoakAsync(fileId, report, cancellationToken);
            await RunRoomInteractionsAsync(report, cancellationToken);
            await SaveSnapshotAsync(fileId, cancellationToken);
            report.SnapshotPersisted = true;
            var expectedSnapshotText = ReadCurrentDocumentText();
            if (options.CheckReconnect && _peers.Count > 1)
                await CheckReconnectBurstAsync(expectedSnapshotText, report, cancellationToken);
            if (options.RestartCheckpoint)
                await CheckManualRestartRecoveryAsync(fileId, expectedSnapshotText, report, cancellationToken);
            if (options.ExpiryRecovery)
                await CheckExpiredRoomRecoveryAsync(fileId, report, cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            report.Cancelled = true;
        }
        catch (Exception exception)
        {
            _errors.Enqueue(exception.GetType().Name);
        }
        finally
        {
            await CleanupAsync();
        }

        stopwatch.Stop();
        report.DurationSeconds = stopwatch.Elapsed.TotalSeconds;
        report.CompletedAtUtc = DateTimeOffset.UtcNow;
        report.ParticipantCount = _peers.Count(peer => peer.Joined);
        report.ExpectedParticipantCount = options.Participants;
        report.ConnectionSuccessRate = _peers.Count == 0 ? 0 : (double)report.ConnectionLatenciesMilliseconds.Count / options.Participants;
        report.JoinSuccessRate = (double)_peers.Count(peer => peer.Joined) / options.Participants;
        report.ConnectionLatency ??= LatencySummary.From(report.ConnectionLatenciesMilliseconds);
        report.JoinLatency ??= LatencySummary.From(report.JoinLatenciesMilliseconds);
        report.Errors = _errors.ToArray();
        report.Succeeded = !report.Cancelled && report.Errors.Length == 0 && report.CrdtConverged == true &&
            report.MissingDeliveries == 0 && report.DuplicateOperations == 0 &&
            report.ConnectionSuccessRate == 1 && report.JoinSuccessRate == 1 && report.DuplicateRoomEvents == 0 &&
            report.RoomIsolationVerified == true &&
            (!options.CheckReconnect || report.RecoveredSnapshotMatches == true) &&
            (!options.RestartCheckpoint || report.RecoveredSnapshotMatches == true) &&
            (!options.ExpiryRecovery || report.RoomExpiryRecoveryVerified == true);
        return report;
    }

    private static async Task<double> CheckHealthAsync(HttpClient http, CancellationToken cancellationToken)
    {
        var timer = Stopwatch.StartNew();
        using var response = await http.GetAsync("health", cancellationToken);
        response.EnsureSuccessStatusCode();
        return timer.Elapsed.TotalMilliseconds;
    }

    private async Task<RoomInvitation> CreateRoomAsync(
        HttpClient http,
        LoadReport report,
        CancellationToken cancellationToken)
    {
        var timer = Stopwatch.StartNew();
        using var response = await http.PostAsync("api/rooms", content: null, cancellationToken);
        response.EnsureSuccessStatusCode();
        report.RoomCreationMilliseconds = timer.Elapsed.TotalMilliseconds;
        return await response.Content.ReadFromJsonAsync<RoomInvitation>(cancellationToken: cancellationToken)
            ?? throw new InvalidOperationException("Room creation returned an invalid response.");
    }

    private LoadPeer CreatePeer(string siteId)
    {
        var connection = new HubConnectionBuilder()
            .WithUrl(new Uri(options.BaseUrl, "collabhub"))
            .WithAutomaticReconnect()
            .Build();
        var peer = new LoadPeer(siteId, connection, _invitation!, _roomPrefix, _importSiteId!, _sentAt, _propagationLatencies);
        if (_documentFileId is not null) peer.ExpectFile(_documentFileId);
        _peers.Add(peer);
        return peer;
    }

    private static async Task<double> StartPeerAsync(LoadPeer peer, CancellationToken cancellationToken)
    {
        var timer = Stopwatch.StartNew();
        await peer.Connection.StartAsync(cancellationToken);
        return timer.Elapsed.TotalMilliseconds;
    }

    private static async Task<(double? Latency, string? Error)> TryStartPeerAsync(
        LoadPeer peer,
        CancellationToken cancellationToken)
    {
        var timer = Stopwatch.StartNew();
        try
        {
            await peer.Connection.StartAsync(cancellationToken);
            return (timer.Elapsed.TotalMilliseconds, null);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception) when (exception is HubException or HttpRequestException or InvalidOperationException or TaskCanceledException)
        {
            return (null, exception.GetType().Name);
        }
    }

    private async Task<JoinResult> JoinPeerAsync(
        LoadPeer peer,
        HubConnection approver,
        CancellationToken cancellationToken)
    {
        var creatorToken = peer.SiteId.EndsWith("participant-000", StringComparison.Ordinal)
            ? peer.Invitation.CreatorToken
            : null;
        var result = await InvokeJoinAsync(peer, creatorToken, cancellationToken);
        if (result.Status == "pending")
        {
            await approver.InvokeAsync("ApproveRoomJoinRequest", peer.Invitation.RoomId, peer.RequestId, cancellationToken);
            await peer.Approval.Task.WaitAsync(TimeSpan.FromSeconds(15), cancellationToken);
            result = await InvokeJoinAsync(peer, null, cancellationToken);
        }
        if (result.Status != "joined") throw new InvalidOperationException("A participant could not join the test room.");
        peer.Joined = true;
        return result;
    }

    private async Task<(double? Latency, string? Error)> TryJoinPeerAsync(
        LoadPeer peer,
        CancellationToken cancellationToken)
    {
        var timer = Stopwatch.StartNew();
        try
        {
            await JoinPeerAsync(peer, _adminConnection!, cancellationToken);
            return (timer.Elapsed.TotalMilliseconds, null);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception) when (exception is HubException or HttpRequestException or InvalidOperationException or TaskCanceledException)
        {
            return (null, exception.GetType().Name);
        }
    }

    private static Task<JoinResult> InvokeJoinAsync(
        LoadPeer peer,
        string? creatorToken,
        CancellationToken cancellationToken) =>
        peer.Connection.InvokeAsync<JoinResult>(
            "JoinRoom",
            peer.Invitation.RoomId,
            peer.Invitation.AccessKey,
            peer.SiteId,
            "#38bdf8",
            creatorToken,
            null,
            peer.RequestId,
            cancellationToken);

    private async Task ConnectParticipantsAsync(LoadReport report, CancellationToken cancellationToken)
    {
        var participants = Enumerable.Range(1, options.Participants - 1)
            .Select(index => CreatePeer($"{_roomPrefix}participant-{index:000}"))
            .ToArray();
        var connectionResults = await Task.WhenAll(participants.Select(peer => TryStartPeerAsync(peer, cancellationToken)));
        foreach (var result in connectionResults)
        {
            if (result.Latency is { } latency) report.ConnectionLatenciesMilliseconds.Add(latency);
            else _errors.Enqueue($"SignalR participant connection failed ({result.Error}).");
        }
        var connectedParticipants = participants.Where(peer => peer.Connection.State == HubConnectionState.Connected).ToArray();

        var joiningNow = connectedParticipants.Length >= 3 ? connectedParticipants[..^1] : connectedParticipants;
        if (connectedParticipants.Length >= 3) _lateJoiningPeer = connectedParticipants[^1];
        var joinResults = await Task.WhenAll(joiningNow.Select(peer => TryJoinPeerAsync(peer, cancellationToken)));
        foreach (var result in joinResults)
        {
            if (result.Latency is { } latency) report.JoinLatenciesMilliseconds.Add(latency);
            else _errors.Enqueue($"SignalR participant join failed ({result.Error}).");
        }
    }

    private async Task JoinLateParticipantAsync(
        LoadReport report,
        string[] expectedTexts,
        CancellationToken cancellationToken)
    {
        if (_lateJoiningPeer is null) return;
        _lateJoiningPeer.ClearSnapshotSignal();
        var timer = Stopwatch.StartNew();
        await JoinPeerAsync(_lateJoiningPeer, _adminConnection!, cancellationToken);
        await _lateJoiningPeer.WaitForSnapshotAsync(TimeSpan.FromSeconds(options.TimeoutSeconds), cancellationToken);
        _lateJoiningPeer.SeedRecoveredSnapshot();
        timer.Stop();
        report.JoinLatenciesMilliseconds.Add(timer.Elapsed.TotalMilliseconds);
        report.RecoveredSnapshotMatches = _lateJoiningPeer.ReadRecoveredSnapshot() == expectedTexts[0];
        if (report.RecoveredSnapshotMatches != true)
        {
            report.CrdtConverged = false;
            _errors.Enqueue("A participant joining during edits did not recover the shared document.");
        }
        await RunConcurrentPostJoinEditsAsync(report, cancellationToken);
    }

    private async Task RunConcurrentPostJoinEditsAsync(LoadReport report, CancellationToken cancellationToken)
    {
        var peers = _peers.Where(peer => peer.Joined).ToArray();
        foreach (var peer in peers) peer.ExpectReceivedOperations(peers.Length - 1);
        var timer = Stopwatch.StartNew();
        await Task.WhenAll(peers.Select(async peer =>
        {
            var previousId = peer.SentOperations
                .Where(item => item.Operation.Type == "insert" && item.Operation.Character!.Id.SiteId == peer.SiteId)
                .Select(item => item.Operation.Character!.Id)
                .OrderBy(id => id.Counter)
                .LastOrDefault();
            var id = new CrdtId(peer.SiteId, (previousId?.Counter ?? 0) + 1);
            var operation = CrdtOperation.Insert(id, "z", previousId);
            var timed = new TimedOperation(operation.Key, operation);
            peer.SentOperations.Add(timed);
            peer.SentAt[operation.Key] = Stopwatch.GetTimestamp();
            report.IncrementOperations();
            await peer.Connection.InvokeAsync(
                "SendFileOp", peer.Invitation.RoomId, _documentFileId!, operation.ToWirePayload(), cancellationToken);
        }));
        await Task.WhenAll(peers.Select(peer => peer.WaitForExpectedOperationsAsync(
            TimeSpan.FromSeconds(options.TimeoutSeconds), cancellationToken)));
        timer.Stop();
        report.EditPropagationMilliseconds = Math.Max(report.EditPropagationMilliseconds ?? 0, timer.Elapsed.TotalMilliseconds);

        var sent = peers.SelectMany(peer => peer.SentOperations).ToArray();
        VerifyDelivery(peers, sent, report);
        var states = peers.Select(peer => new CrdtReplica(
            peer.SentOperations.Select(item => item.Operation).Concat(peer.ReceivedOperations.Values))
            .GetVisibleText()).Distinct(StringComparer.Ordinal).ToArray();
        report.CrdtConverged = states.Length == 1;
        if (!report.CrdtConverged.Value) _errors.Enqueue("The document did not converge when a participant joined during editing.");
        report.DuplicateOperations = peers.Sum(peer => peer.DuplicateOperations);
        report.ExpectedOperationDeliveries += peers.Length * (peers.Length - 1);
        report.ObservedOperationDeliveries = peers.Sum(peer => peer.LiveReceivedOperationCount);
        report.OperationThroughputPerSecond = report.TotalOperations / Math.Max(timer.Elapsed.TotalSeconds, .001);
        report.PropagationLatency = LatencySummary.From(_propagationLatencies);
        report.PropagationLatenciesMilliseconds.Clear();
        report.PropagationLatenciesMilliseconds.AddRange(_propagationLatencies);
    }

    private async Task CheckManualRestartRecoveryAsync(
        string fileId,
        string expectedText,
        LoadReport report,
        CancellationToken cancellationToken)
    {
        foreach (var peer in _peers) await peer.Connection.StopAsync(cancellationToken);
        Console.WriteLine("All room participants are disconnected. Restart the local room-server or Redis service, wait for it to recover, then press Enter.");
        await Console.In.ReadLineAsync(cancellationToken);

        var timer = Stopwatch.StartNew();
        foreach (var peer in _peers.OrderByDescending(peer => peer.SiteId.EndsWith("participant-000", StringComparison.Ordinal)))
        {
            peer.ClearSnapshotSignal();
            await peer.Connection.StartAsync(cancellationToken);
            await JoinPeerAsync(peer, _adminConnection!, cancellationToken);
            await peer.WaitForSnapshotAsync(TimeSpan.FromSeconds(options.TimeoutSeconds), cancellationToken);
            peer.SeedRecoveredSnapshot();
            if (peer.ReadRecoveredSnapshot() != expectedText)
                _errors.Enqueue("A participant failed to recover the saved document after service restart.");
        }
        report.ReconnectMilliseconds = timer.Elapsed.TotalMilliseconds;
        report.RecoveredSnapshotMatches = _errors.IsEmpty;
        report.SnapshotPersisted = report.SnapshotPersisted == true;
    }

    private async Task CheckExpiredRoomRecoveryAsync(
        string fileId,
        LoadReport report,
        CancellationToken cancellationToken)
    {
        var expectedText = ReadCurrentDocumentText();
        var snapshotOperations = _peers.SelectMany(peer =>
            peer.SentOperations.Select(item => item.Operation).Concat(peer.ReceivedOperations.Values));
        var snapshot = new CrdtReplica(snapshotOperations).ToSnapshot();
        var rootFile = new
        {
            path = "load-test.txt",
            id = fileId,
            compressedSnapshot = Compress(snapshot)
        };

        await Task.WhenAll(_peers.Select(peer => peer.Connection.StopAsync(cancellationToken)));
        Console.WriteLine($"Participants are offline. Waiting {options.ExpiryWaitSeconds} seconds for the local room expiry and cleanup sweep.");
        report.RoomExpiryWaitSeconds = options.ExpiryWaitSeconds;
        await Task.Delay(TimeSpan.FromSeconds(options.ExpiryWaitSeconds), cancellationToken);

        var timer = Stopwatch.StartNew();
        var admin = _peers.First(peer => peer.SiteId.EndsWith("participant-000", StringComparison.Ordinal));
        await admin.Connection.StartAsync(cancellationToken);
        admin.ClearSnapshotSignal();
        var restoredRoom = await JoinPeerAsync(admin, admin.Connection, cancellationToken);
        if (!restoredRoom.Recovered)
            throw new InvalidOperationException("The room was not restored from its expired-room recovery record.");

        var restoreOperations = await admin.Connection.InvokeAsync<object[]>(
            "RestoreExpiredWorkspace", new[] { rootFile }, "load-test", cancellationToken);
        report.ProjectTreeOperations += restoreOperations.Length;
        await admin.WaitForSnapshotAsync(TimeSpan.FromSeconds(options.TimeoutSeconds), cancellationToken);
        admin.SeedRecoveredSnapshot();
        var snapshotMatches = admin.ReadRecoveredSnapshot() == expectedText;

        foreach (var peer in _peers.Where(peer => !ReferenceEquals(peer, admin)))
        {
            peer.ClearSnapshotSignal();
            await peer.Connection.StartAsync(cancellationToken);
            await JoinPeerAsync(peer, admin.Connection, cancellationToken);
            await peer.WaitForSnapshotAsync(TimeSpan.FromSeconds(options.TimeoutSeconds), cancellationToken);
            peer.SeedRecoveredSnapshot();
            snapshotMatches &= peer.ReadRecoveredSnapshot() == expectedText;
        }

        timer.Stop();
        report.ReconnectMilliseconds = timer.Elapsed.TotalMilliseconds;
        report.RecoveredSnapshotMatches = snapshotMatches;
        report.RoomExpiryRecoveryVerified = restoredRoom.Recovered && snapshotMatches && restoreOperations.Length > 0;
        if (!report.RoomExpiryRecoveryVerified.Value)
            _errors.Enqueue("The expired room did not recover the expected workspace snapshot.");
        report.SnapshotPersisted = report.SnapshotPersisted == true;
    }

    private string ReadCurrentDocumentText()
    {
        var operations = _peers.SelectMany(peer =>
            peer.SentOperations.Select(item => item.Operation)
                .Concat(peer.ReceivedOperations.Values));
        return new CrdtReplica(operations).GetVisibleText();
    }

    private async Task RunRoomInteractionsAsync(LoadReport report, CancellationToken cancellationToken)
    {
        var peers = _peers.Where(peer => peer.Joined).ToArray();
        foreach (var peer in peers) peer.ExpectChatEvents(peers.Length);
        await Task.WhenAll(peers.Select(peer => peer.Connection.InvokeAsync(
            "SendChatMessage", _invitation!.RoomId, $"{_roomPrefix}{peer.SiteId}:chat", cancellationToken)));
        await Task.WhenAll(peers.Select(peer => peer.WaitForChatAsync(
            TimeSpan.FromSeconds(options.TimeoutSeconds), cancellationToken)));
        report.ChatMessages = peers.Length;

        foreach (var peer in peers) peer.ExpectAwarenessEvents(peers.Length - 1);
        await Task.WhenAll(peers.Select(peer => peer.Connection.InvokeAsync(
            "UpdateAwareness",
            _invitation!.RoomId,
            new { probe = $"{_roomPrefix}{peer.SiteId}:presence", cursor = new { line = 1, column = 1 } },
            cancellationToken)));
        await Task.WhenAll(peers.Select(peer => peer.WaitForAwarenessAsync(
            TimeSpan.FromSeconds(options.TimeoutSeconds), cancellationToken)));
        report.PresenceUpdates = peers.Length;

        var folderId = Guid.NewGuid().ToString("N");
        var fileId = Guid.NewGuid().ToString("N");
        var siteId = $"{_roomPrefix}tree";
        var operations = new object[]
        {
            new { type = "create", opId = new { siteId, counter = 1 }, entry = new { id = folderId, name = "load-folder", parentId = (string?)null, isFolder = true } },
            new { type = "create", opId = new { siteId, counter = 2 }, entry = new { id = fileId, name = "load-file.txt", parentId = (string?)folderId, isFolder = false } },
            new { type = "rename", opId = new { siteId, counter = 3 }, entryId = fileId, name = "renamed.txt" },
            new { type = "move", opId = new { siteId, counter = 4 }, entryId = fileId, parentId = (string?)null },
            new { type = "delete", opId = new { siteId, counter = 5 }, entryId = fileId },
            new { type = "delete", opId = new { siteId, counter = 6 }, entryId = folderId }
        };
        var treePeers = peers.Take(90).ToArray();
        var concurrentFiles = treePeers.Select(peer =>
        {
            var id = Guid.NewGuid().ToString("N");
            return new
            {
                Peer = peer,
                Id = id,
                Operation = (object)new
                {
                    type = "create",
                    opId = new { siteId = peer.SiteId, counter = 1 },
                    entry = new { id, name = $"{peer.SiteId[^8..]}.txt", parentId = (string?)null, isFolder = false }
                }
            };
        }).ToArray();
        var cleanupOperations = concurrentFiles.Select(item => new
        {
            item.Peer,
            Operation = (object)new
            {
                type = "delete",
                opId = new { siteId = item.Peer.SiteId, counter = 2 },
                entryId = item.Id
            }
        }).ToArray();
        for (var index = 0; index < peers.Length; index++)
        {
            var peerExpected = treePeers.Contains(peers[index])
                ? operations.Length + 2 * (treePeers.Length - 1)
                : operations.Length + 2 * treePeers.Length;
            peers[index].ExpectTreeEvents(index == 0 ? 2 * (treePeers.Length - 1) : peerExpected);
        }
        foreach (var operation in operations)
        {
            peers[0].RecordSentTreeOperation(JsonSerializer.SerializeToElement(operation));
            await _adminConnection!.InvokeAsync("ApplyProjectTreeOperation", _invitation!.RoomId, operation, cancellationToken);
        }
        foreach (var item in concurrentFiles)
            item.Peer.RecordSentTreeOperation(JsonSerializer.SerializeToElement(item.Operation));
        await Task.WhenAll(concurrentFiles.Select(item => item.Peer.Connection.InvokeAsync(
            "ApplyProjectTreeOperation", _invitation!.RoomId, item.Operation, cancellationToken)));
        foreach (var item in cleanupOperations)
            item.Peer.RecordSentTreeOperation(JsonSerializer.SerializeToElement(item.Operation));
        await Task.WhenAll(cleanupOperations.Select(item => item.Peer.Connection.InvokeAsync(
            "ApplyProjectTreeOperation", _invitation!.RoomId, item.Operation, cancellationToken)));
        await Task.WhenAll(peers.Select(peer => peer.WaitForTreeAsync(
            TimeSpan.FromSeconds(options.TimeoutSeconds), cancellationToken)));
        report.ProjectTreeOperations = operations.Length + concurrentFiles.Length + cleanupOperations.Length;

        var allTreeOperations = peers.SelectMany(peer => peer.KnownTreeOperations)
            .ToHashSet(StringComparer.Ordinal);
        var expectedTreeOperationCount = report.ProjectTreeOperations;
        if (allTreeOperations.Count != expectedTreeOperationCount ||
            peers.Any(peer => !peer.KnownTreeOperations.SetEquals(allTreeOperations)))
            _errors.Enqueue("Project tree operation sets did not converge across room participants.");

        var unexpected = _peers.Sum(peer => peer.UnexpectedRoomEvents);
        report.DuplicateRoomEvents = _peers.Sum(peer => peer.DuplicateRoomEvents);
        if (unexpected > 0) _errors.Enqueue("Participants received events from another room or document.");
        if (report.DuplicateRoomEvents > 0) _errors.Enqueue("Room collaboration events were delivered more than once.");
        report.RoomIsolationVerified = unexpected == 0;
    }

    private async Task<string[]> RunConcurrentEditsAsync(
        string fileId,
        LoadReport report,
        CancellationToken cancellationToken)
    {
        var peers = _peers.Where(peer => peer.Joined).ToArray();
        var expectedInsertionsPerPeer = (peers.Length - 1) * options.OperationsPerParticipant;
        foreach (var peer in peers) peer.ExpectReceivedOperations(expectedInsertionsPerPeer);

        var timer = Stopwatch.StartNew();
        await Task.WhenAll(peers.Select(peer => SendInsertionsAsync(peer, fileId, report, cancellationToken)));
        await Task.WhenAll(peers.Select(peer => peer.WaitForExpectedOperationsAsync(
            TimeSpan.FromSeconds(options.TimeoutSeconds), cancellationToken)));

        var expectedDeletionsPerPeer = peers.Length - 1;
        foreach (var peer in peers) peer.ExpectReceivedOperations(expectedDeletionsPerPeer);
        await Task.WhenAll(peers.Select(peer => SendDeletionAsync(peer, fileId, report, cancellationToken)));
        await Task.WhenAll(peers.Select(peer => peer.WaitForExpectedOperationsAsync(
            TimeSpan.FromSeconds(options.TimeoutSeconds), cancellationToken)));
        report.EditPropagationMilliseconds = timer.Elapsed.TotalMilliseconds;

        var sent = peers.SelectMany(peer => peer.SentOperations).ToArray();
        VerifyDelivery(peers, sent, report);
        var replicaTexts = peers.Select(peer => new CrdtReplica(
            peer.SentOperations.Select(operation => operation.Operation)
                .Concat(peer.ReceivedOperations.Values)
        ).GetVisibleText()).Distinct(StringComparer.Ordinal).ToArray();
        report.CrdtConverged = replicaTexts.Length == 1;
        report.DuplicateOperations = peers.Sum(peer => peer.DuplicateOperations);
        report.ExpectedOperationDeliveries = sent.Length * (peers.Length - 1);
        report.ObservedOperationDeliveries = peers.Sum(peer => peer.LiveReceivedOperationCount);
        report.OperationThroughputPerSecond = report.TotalOperations / Math.Max(timer.Elapsed.TotalSeconds, 0.001);
        report.PropagationLatency = LatencySummary.From(_propagationLatencies);
        report.PropagationLatenciesMilliseconds.AddRange(_propagationLatencies);
        report.ConnectionLatency = LatencySummary.From(report.ConnectionLatenciesMilliseconds);
        report.JoinLatency = LatencySummary.From(report.JoinLatenciesMilliseconds);
        return replicaTexts;
    }

    private async Task RunSoakAsync(string fileId, LoadReport report, CancellationToken cancellationToken)
    {
        if (options.SoakSeconds == 0) return;
        var peers = _peers.Where(peer => peer.Joined).ToArray();
        var stopwatch = Stopwatch.StartNew();
        var round = 0;
        while (round < options.SoakSeconds)
        {
            cancellationToken.ThrowIfCancellationRequested();
            round++;
            foreach (var peer in peers) peer.ExpectReceivedOperations(peers.Length - 1);
            await Task.WhenAll(peers.Select(peer => SendSoakInsertionAsync(peer, fileId, round, report, cancellationToken)));
            await Task.WhenAll(peers.Select(peer => peer.WaitForExpectedOperationsAsync(
                TimeSpan.FromSeconds(options.TimeoutSeconds), cancellationToken)));
            if (round < options.SoakSeconds) await Task.Delay(TimeSpan.FromSeconds(1), cancellationToken);
        }
        stopwatch.Stop();
        report.SoakDurationSeconds = stopwatch.Elapsed.TotalSeconds;

        var sent = peers.SelectMany(peer => peer.SentOperations).ToArray();
        VerifyDelivery(peers, sent, report);
        var states = peers.Select(peer => new CrdtReplica(
            peer.SentOperations.Select(item => item.Operation).Concat(peer.ReceivedOperations.Values))
            .GetVisibleText()).Distinct(StringComparer.Ordinal).ToArray();
        report.CrdtConverged = states.Length == 1;
        if (!report.CrdtConverged.Value) _errors.Enqueue("CRDT replicas did not converge after the sustained workload.");
        report.DuplicateOperations = peers.Sum(peer => peer.DuplicateOperations);
        report.ExpectedOperationDeliveries += peers.Length * round * (peers.Length - 1);
        report.ObservedOperationDeliveries = peers.Sum(peer => peer.LiveReceivedOperationCount);
        report.OperationThroughputPerSecond = peers.Length * round / Math.Max(stopwatch.Elapsed.TotalSeconds, .001);
        report.PropagationLatency = LatencySummary.From(_propagationLatencies);
        report.PropagationLatenciesMilliseconds.Clear();
        report.PropagationLatenciesMilliseconds.AddRange(_propagationLatencies);
    }

    private async Task SendSoakInsertionAsync(
        LoadPeer peer,
        string fileId,
        int round,
        LoadReport report,
        CancellationToken cancellationToken)
    {
        var previousCounter = peer.SentOperations
            .Where(item => item.Operation.Type == "insert" && item.Operation.Character!.Id.SiteId == peer.SiteId)
            .Select(item => item.Operation.Character!.Id.Counter)
            .DefaultIfEmpty(0)
            .Max();
        var counter = previousCounter + 1;
        var origin = counter == 1 ? null : new CrdtId(peer.SiteId, previousCounter);
        var id = new CrdtId(peer.SiteId, counter);
        var operation = CrdtOperation.Insert(id, ((char)('a' + (round - 1) % 26)).ToString(), origin);
        peer.SentOperations.Add(new TimedOperation(operation.Key, operation));
        peer.SentAt[operation.Key] = Stopwatch.GetTimestamp();
        report.IncrementOperations();
        await peer.Connection.InvokeAsync(
            "SendFileOp", peer.Invitation.RoomId, fileId, operation.ToWirePayload(), cancellationToken);
    }

    private void VerifyDelivery(IReadOnlyList<LoadPeer> peers, IReadOnlyList<TimedOperation> sent, LoadReport report)
    {
        var expected = sent.Select(operation => operation.Key).ToHashSet(StringComparer.Ordinal);
        foreach (var peer in peers)
        {
            var actual = peer.SentOperations.Select(operation => operation.Key)
                .Concat(peer.ReceivedOperations.Keys)
                .ToHashSet(StringComparer.Ordinal);
            report.MissingDeliveries += expected.Except(actual, StringComparer.Ordinal).Count();
            if (!expected.SetEquals(actual)) _errors.Enqueue($"{peer.SiteId} missed operations.");
        }
    }

    private async Task SendInsertionsAsync(
        LoadPeer peer,
        string fileId,
        LoadReport report,
        CancellationToken cancellationToken)
    {
        CrdtId? origin = null;
        for (var counter = 1; counter <= options.OperationsPerParticipant; counter++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var id = new CrdtId(peer.SiteId, counter);
            var operation = CrdtOperation.Insert(id, ((char)('a' + (counter - 1) % 26)).ToString(), origin);
            var timed = new TimedOperation(operation.Key, operation);
            peer.SentOperations.Add(timed);
            peer.SentAt[operation.Key] = Stopwatch.GetTimestamp();
            report.IncrementOperations();
            await peer.Connection.InvokeAsync(
                "SendFileOp",
                peer.Invitation.RoomId,
                fileId,
                operation.ToWirePayload(),
                cancellationToken);
            origin = id;
        }
    }

    private async Task SendDeletionAsync(
        LoadPeer peer,
        string fileId,
        LoadReport report,
        CancellationToken cancellationToken)
    {
        var target = new CrdtId(peer.SiteId, options.OperationsPerParticipant);
        var operation = CrdtOperation.Delete(target);
        peer.SentOperations.Add(new TimedOperation(operation.Key, operation));
        peer.SentAt[operation.Key] = Stopwatch.GetTimestamp();
        report.IncrementOperations();
        await peer.Connection.InvokeAsync(
            "SendFileOp",
            peer.Invitation.RoomId,
            fileId,
            operation.ToWirePayload(),
            cancellationToken);
    }

    private async Task SaveSnapshotAsync(string fileId, CancellationToken cancellationToken)
    {
        var operations = _peers.SelectMany(peer => peer.SentOperations.Select(item => item.Operation)).ToArray();
        var snapshot = new CrdtReplica(operations).ToSnapshot();
        await _adminConnection!.InvokeAsync("SaveFileSnapshot", _invitation!.RoomId, fileId, snapshot, cancellationToken);
    }

    private async Task CheckReconnectBurstAsync(
        string expectedText,
        LoadReport report,
        CancellationToken cancellationToken)
    {
        await Task.WhenAll(_peers.Where(peer => peer.Joined)
            .Select(peer => peer.Connection.StopAsync(cancellationToken)));
        var peers = _peers.Where(peer => peer.Joined).ToArray();
        foreach (var peer in peers) peer.ClearSnapshotSignal();
        var timer = Stopwatch.StartNew();
        await Task.WhenAll(peers.Select(peer => StartPeerAsync(peer, cancellationToken)));
        await Task.WhenAll(peers.Select(peer => JoinPeerAsync(peer, _adminConnection!, cancellationToken)));
        await Task.WhenAll(peers.Select(peer => peer.WaitForSnapshotAsync(
            TimeSpan.FromSeconds(options.TimeoutSeconds), cancellationToken)));
        foreach (var peer in peers) peer.SeedRecoveredSnapshot();
        report.ReconnectMilliseconds = timer.Elapsed.TotalMilliseconds;
        report.RecoveredSnapshotMatches = peers.All(peer => peer.ReadRecoveredSnapshot() == expectedText);
    }

    private async Task ImportEmptyDocumentAsync(
        HubConnection connection,
        string fileId,
        CancellationToken cancellationToken)
    {
        await connection.InvokeAsync(
            "ImportProject",
            _invitation!.RoomId,
            _importSiteId!["import-".Length..],
            new[] { new { path = "load-test.txt", id = fileId, compressedSnapshot = Compress("{\"clock\":0,\"chars\":[]}") } },
            null,
            "load-test",
            false,
            cancellationToken);
    }

    private async Task CleanupAsync()
    {
        foreach (var peer in _peers.AsEnumerable().Reverse())
        {
            try
            {
                if (peer.Joined) await peer.Connection.InvokeAsync("LeaveRoom", peer.Invitation.RoomId);
                else await peer.Connection.InvokeAsync("CancelJoinRequest", peer.Invitation.RoomId, peer.RequestId);
            }
            catch { }
            try { await peer.DisposeAsync(); }
            catch { }
        }
    }

    private static string Compress(string value)
    {
        using var output = new MemoryStream();
        using (var gzip = new GZipStream(output, CompressionLevel.Fastest, leaveOpen: true))
            gzip.Write(Encoding.UTF8.GetBytes(value));
        return "gzip:v1:" + Convert.ToBase64String(output.ToArray());
    }
}

internal sealed record RoomInvitation(string RoomId, string AccessKey, string CreatorToken);
internal sealed record JoinResult(string Status, bool Recovered = false);
