# Load testing

The harness drives Syncode's real room API, SignalR hub, CRDT relay, project tree, chat, presence, reconnect flow, snapshot persistence, and isolated terminal run. It checks state correctness alongside latency and delivery counts.

Use it only with local services or a deployment you control. Never point it at production. The defaults are small. Increase the load in steps and watch the load generator as well as the server.

## What a run covers

The .NET SignalR generator creates rooms through `POST /api/rooms`. Simulated clients join with the actual invitation and creator tokens. Guests use the admin approval flow. No GitHub login is required because current room access uses invitations.

Each room scenario performs concurrent CRDT insertions and deletions, then checks delivery, duplicates, convergence, and propagation percentiles. With three or more participants, one participant joins after the edits and checks snapshot recovery. The workload also exercises project tree create, rename, move, delete, simultaneous file creation, chat, presence, room isolation, and saved snapshots.

Optional switches test a simultaneous SignalR reconnect burst, pause for a manual local service restart, wait for actual room expiry and restore the client-held snapshot, run active JavaScript files through the isolated terminal service, check that an offline package-install failure is returned cleanly, and capture local Docker and Redis metrics. Multi-room scenarios run at the same time after staggering room creation to stay within Syncode's room creation limit.

The report includes commit, date, environment, server and load-generator specifications, participant and room counts, connection and join success rates, operation counts and throughput, latency percentiles, delivery and convergence checks, snapshot and reconnect results, execution output and cleanup, Docker statistics, and Redis memory and command statistics. JSON and CSV files go to `load-tests/results`. Reports contain room IDs but omit invitation keys, creator tokens, and execution API keys.

## Start the local stack

The Compose override shortens test room expiry and the cleanup sweep to one minute. It also allows local capacity limits to be raised without changing normal Compose defaults. Start the stack with this override for tests so generated rooms expire quickly.

```powershell
docker compose --env-file infra/.env -f infra/docker-compose.local.yml -f load-tests/docker-compose.local.override.yml up -d --build
dotnet build load-tests/Syncode.LoadTests.csproj
```

The default server allows six participants per room, 50 SignalR connections per instance, and ten active rooms. Start with the two participant smoke run.

```powershell
dotnet run --project load-tests/Syncode.LoadTests.csproj -- --participants 2
```

## Progressive collaboration runs

Increase participants only after the earlier run succeeds. The harness supports up to 100 participants total and up to ten rooms. Room and connection capacity must be raised in the local server before going beyond its configured caps.

```powershell
dotnet run --project load-tests/Syncode.LoadTests.csproj -- --participants 5
dotnet run --project load-tests/Syncode.LoadTests.csproj -- --participants 10
dotnet run --project load-tests/Syncode.LoadTests.csproj -- --participants 25
```

For a 50 participant local run, raise the room and connection caps first.

```powershell
$env:SYNCODE_LOAD_MAX_PARTICIPANTS = "50"
$env:SYNCODE_LOAD_MAX_CONNECTIONS = "50"
$env:SYNCODE_LOAD_MAX_ACTIVE_ROOMS = "10"
docker compose --env-file infra/.env -f infra/docker-compose.local.yml -f load-tests/docker-compose.local.override.yml up -d --build room-server
dotnet run --project load-tests/Syncode.LoadTests.csproj -- --participants 50 --operations 5
```

For 100 participants, set both participant and connection caps to 100. The generator also limits the combined number of participants across rooms to 100 and the run to one million expected CRDT deliveries.

Test independent rooms with the same participant count per room.

```powershell
dotnet run --project load-tests/Syncode.LoadTests.csproj -- --rooms 2 --participants 5 --operations 10
```

Run a sustained collaborative workload with one concurrent insertion per participant each second. The maximum duration is one hour and the same operation delivery budget still applies.

```powershell
dotnet run --project load-tests/Syncode.LoadTests.csproj -- --participants 5 --operations 10 --soak-seconds 300 --docker-metrics
```

`--docker-metrics` samples local Compose containers and Redis every five seconds, with before and after snapshots. It requires Docker Desktop and the local Compose stack.

## Reconnect and recovery

The reconnect option disconnects every participant at once, starts their SignalR connections concurrently, rejoins them through the approved-member path, and compares each received snapshot with the shared document.

```powershell
dotnet run --project load-tests/Syncode.LoadTests.csproj -- --participants 3 --reconnect
```

The restart checkpoint is local only. The harness persists a document snapshot, disconnects its participants, and waits for you. In another PowerShell window, restart either the room server or Redis.

```powershell
docker compose --env-file infra/.env -f infra/docker-compose.local.yml restart room-server
```

Or restart Redis.

```powershell
docker compose --env-file infra/.env -f infra/docker-compose.local.yml restart redis
```

After the service is healthy, return to the harness window and press Enter. It reconnects the participants and compares each recovered snapshot. The checkpoint does not restart a service automatically.

```powershell
dotnet run --project load-tests/Syncode.LoadTests.csproj -- --participants 3 --restart-checkpoint
```

Redis recovery depends on the local Redis AOF volume being intact. Do not use `down -v` during this check.

Expired-room recovery verifies Syncode's actual archive path. The harness saves the current document in its local test memory, disconnects every participant, waits for the one-minute local expiry and cleanup sweep, rejoins with the creator invitation, restores the project snapshot through `RestoreExpiredWorkspace`, and then checks returning members and recovered text. The wait defaults to 130 seconds to cover the expiry threshold and cleanup interval.

```powershell
dotnet run --project load-tests/Syncode.LoadTests.csproj -- --participants 3 --expiry-recovery
```

This check takes a little over two minutes. It requires the local Compose override to be active. It does not simulate browser IndexedDB; the saved snapshot is the same compressed CRDT payload that the browser would upload.

## Isolated execution run

The execution scenario uses the existing authenticated terminal API to start isolated Bash sessions, run a small JavaScript file, check its output, close the sessions, verify cleanup, and make an offline attempt to install a deliberately nonexistent package. It is loopback-only and limited to eight concurrent sessions across two rooms to exercise the execution-service instance cap while respecting the four-session per-room limit. The package probe uses npm offline mode, so it makes no network request. The execution service must be enabled, Docker and runner images must be ready, and networking and container limits must remain enabled.

The load runner reads `SYNCODE_EXECUTION_API_KEY` from the environment or the ignored `infra/.env` file. It never writes the key into its report.

```powershell
dotnet run --project load-tests/Syncode.LoadTests.csproj -- --participants 2 --execution --execution-jobs 8
```

The worker interruption checkpoint leaves one long-running isolated session active and asks you to restart the local execution-service. It then waits for the service health check to return and verifies the old session was removed.

```powershell
dotnet run --project load-tests/Syncode.LoadTests.csproj -- --participants 2 --execution --worker-interruption
```

During the pause, run the restart command shown by the harness in another PowerShell window. This is a manual local check, not a remote worker control mechanism.

## k6 HTTP runs

The health script creates one room during setup, then applies bounded health traffic. It accepts at most 100 virtual users, 30 minutes, and 18,000 VU-seconds.

```powershell
k6 run load-tests/k6/http-smoke.js
k6 run --summary-export load-tests/results/k6-health.json -e BASE_URL=http://127.0.0.1:8081 -e VUS=5 -e DURATION=30m load-tests/k6/http-smoke.js
```

The room creation script creates exactly one room per VU and allows at most five VUs to respect the server's creation burst limit. Rooms remain until normal inactivity cleanup.

```powershell
k6 run --summary-export load-tests/results/k6-room-create.json -e BASE_URL=http://127.0.0.1:8081 -e VUS=5 load-tests/k6/room-create.js
```

The default thresholds are under one percent failed requests, health p95 under 500 ms, and room creation p95 under one second. A room creation failure may indicate a rate or active room limit rather than an application outage.

## Controlled remote runs

Use a separate load generator and a controlled non-production deployment. Set the target URL and explicitly allow it. Never pass secrets as command-line arguments. Set `SYNCODE_LOAD_ENVIRONMENT` and `SYNCODE_LOAD_SERVER_SPECS` to label the report.

```powershell
$env:SYNCODE_LOAD_BASE_URL = "https://your-test-host/"
$env:SYNCODE_LOAD_ENVIRONMENT = "staging"
$env:SYNCODE_LOAD_SERVER_SPECS = "4 vCPU, 8 GiB RAM"
dotnet run --project load-tests/Syncode.LoadTests.csproj -- --allow-remote --participants 5
```

The execution scenario and manual restart checkpoint remain loopback-only. Do not disable authentication, gVisor, resource limits, or network restrictions for a benchmark.

## Limits and interpretation

The current execution architecture runs active files in isolated interactive terminal sessions. There is no separate execution job queue to saturate, so `--execution` measures concurrent session capacity, startup, active-file run, output, cleanup, and offline package-install failure handling.

The manual restart checks cover one local Redis, room-server, or execution-service interruption at a time. The harness does not restart remote services, inject arbitrary packet loss, enable package egress, or remove persistent Docker volumes. Network isolation and container resource boundaries remain covered by the existing execution integration checks.

The Docker and Redis samples are observational and do not produce a guaranteed capacity number. Results depend on the server machine, generator machine, runner images, Redis volume, current room count, and local Docker limits. Compare repeated runs with the same workload and machine. A successful run means the configured scenario passed correctness checks. It does not establish a universal user limit.
