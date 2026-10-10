# Syncode execution service

The execution service is an internal .NET host. It accepts authenticated execution requests, stores them in a bounded Redis list, and runs up to three jobs concurrently in isolated Docker containers. By default, the HTTP host binds only to `127.0.0.1:5112`.

## Build runner images

Run from the repository root with Docker Desktop using Linux containers:

```powershell
docker build -t syncode-runner-node -f execution-service/Runner/RunnerImages/Dockerfile.node execution-service/Runner/RunnerImages
docker build -t syncode-runner-python -f execution-service/Runner/RunnerImages/Dockerfile.python execution-service/Runner/RunnerImages
```

The service uses `--pull=never`; build or deploy these reviewed images ahead of time instead of allowing runtime image pulls.

## Start locally

Start a Redis instance that is dedicated to Syncode (or point `Redis` at your existing Syncode Redis instance), then run:

```powershell
$env:Redis = "localhost:6380"
$env:SYNCODE_EXECUTION_API_KEY = "replace-with-a-long-random-local-secret"
dotnet run --project execution-service/Syncode.ExecutionService.csproj
```

The API key is required at startup. Internal callers send it in the `X-Execution-Service-Key` header. Set `ExecutionService__Urls` only when deployment requires another internal bind address; do not expose this service to the public internet.

Execution submissions are limited to 10 per room per rolling minute by default. Excess submissions receive HTTP `429 Too Many Requests`, a `Retry-After` header, and a message suitable for display in the client. Set `ExecutionService__MaxExecutionsPerRoomPerMinute` or `ExecutionService__ExecutionRateWindowMinutes` to adjust the limit. Rate-limit state is shared through Redis across service instances.

## Connect it to the Syncode room server

Run the execution service and room server with the same Redis connection, execution API key, and queue prefix. The execution service publishes stdout, stderr, and completion events through Redis; the room server relays them to the connected room over its existing SignalR hub. The room server keeps the execution service API key server-side.

In the execution-service terminal:

```powershell
$env:Redis = "localhost:6380"
$env:SYNCODE_EXECUTION_API_KEY = "use-the-same-random-secret-in-the-server"
dotnet run --project execution-service/Syncode.ExecutionService.csproj
```

In the room-server terminal:

```powershell
$env:Redis = "localhost:6380"
$env:ExecutionService__BaseUrl = "http://127.0.0.1:5112"
$env:ExecutionService__ApiKey = "use-the-same-random-secret-in-the-execution-service"
$env:ExecutionService__QueuePrefix = "syncode:execution"
dotnet run --project server/Syncode.Server.csproj --launch-profile http
```

The editor Run button currently executes JavaScript (`.js`, `.mjs`, `.cjs`, or `.jsx`) and Python (`.py` or `.pyw`) files. Output is shown progressively in the terminal panel.

Submit a job with `POST /api/executions` and JSON fields `roomId`, `requestedBy`, `language` (`JavaScript` or `Python`), and `source`. The response includes a job ID and approximate queue position. Poll `GET /api/executions/{jobId}` for `pending`, `running`, `completed`, or `failed` status and the bounded output accumulated so far. Live push streaming to the client is a later phase.

## Validate

Run unit tests:

```powershell
dotnet test execution-service.tests/Syncode.ExecutionService.Tests.csproj
```

With Docker available and both images built, enable container integration checks:

```powershell
$env:SYNCODE_RUN_DOCKER_INTEGRATION = "1"
dotnet test execution-service.tests/Syncode.ExecutionService.Tests.csproj
```

Those checks execute Node and Python jobs and verify timeout, network isolation, and the `/tmp` size cap.

With Redis available, test the queue's FIFO order, live pending position, and capacity limit:

```powershell
$env:SYNCODE_REDIS_CONNECTION = "localhost:6380"
dotnet test execution-service.tests/Syncode.ExecutionService.Tests.csproj --filter "Category=RedisIntegration"
```

The queue prefix can be changed with `ExecutionService__QueuePrefix` when the service shares a Redis database with another deployment.
