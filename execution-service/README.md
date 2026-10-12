# Syncode execution service

The execution service is an internal .NET host. It accepts authenticated execution requests, stores them in a bounded Redis list, and runs up to three jobs concurrently in isolated Docker containers. By default, the HTTP host binds only to `127.0.0.1:5112`.

## Build runner images

Run from the repository root with Docker Desktop using Linux containers:

```powershell
docker build -t syncode-runner-node -f execution-service/Runner/RunnerImages/Dockerfile.node execution-service/Runner/RunnerImages
docker build -t syncode-runner-python -f execution-service/Runner/RunnerImages/Dockerfile.python execution-service/Runner/RunnerImages
docker build -t syncode-runner-dotnet -f execution-service/Runner/RunnerImages/Dockerfile.dotnet execution-service/Runner/RunnerImages
docker build -t syncode-runner-c --build-arg RUNNER_RUNTIME=c -f execution-service/Runner/RunnerImages/Dockerfile.native execution-service/Runner/RunnerImages
docker build -t syncode-runner-cpp --build-arg RUNNER_RUNTIME=cpp -f execution-service/Runner/RunnerImages/Dockerfile.native execution-service/Runner/RunnerImages
docker build -t syncode-runner-rust -f execution-service/Runner/RunnerImages/Dockerfile.rust execution-service/Runner/RunnerImages
docker build -t syncode-runner-java -f execution-service/Runner/RunnerImages/Dockerfile.java execution-service/Runner/RunnerImages
```

TypeScript uses the Node image and its pinned TypeScript compiler. The service uses `--pull=never`; build or deploy these reviewed images ahead of time instead of allowing runtime image pulls.

## Start locally

Start a Redis instance that is dedicated to Syncode (or point `Redis` at your existing Syncode Redis instance), then run:

```powershell
$env:Redis = "localhost:6380"
$env:SYNCODE_EXECUTION_API_KEY = "replace-with-a-long-random-local-secret"
dotnet run --project execution-service/Syncode.ExecutionService.csproj
```

The API key is required at startup. Internal callers send it in the `X-Execution-Service-Key` header. Set `ExecutionService__Urls` only when deployment requires another internal bind address; do not expose this service to the public internet.

## Run with Docker Compose

The Compose stack runs the execution service, its Redis instance, a sibling Docker-in-Docker daemon, and a one-shot service that builds all supported runner images. It does not start the Syncode room server or client. The execution API and Redis are published only on loopback so a separately run local room server can connect to them.

From the repository root, create `infra/.env` if it does not exist. Set `SYNCODE_EXECUTION_API_KEY` to at least 32 random bytes, and set `REDIS_PORT` if the default port is unavailable. Keep this file private. Then start the stack:

```powershell
notepad infra/.env
docker compose --env-file infra/.env -f infra/docker-compose.yml up --build
```

The default Redis host port is `6380`, avoiding the common local Redis port `6379`; change `REDIS_PORT` in `infra/.env` if needed. The service binds to `http://127.0.0.1:5112`. To connect a room server running directly on the host, set its Redis connection to `localhost:6380`, `ExecutionService__BaseUrl` to `http://127.0.0.1:5112`, and `ExecutionService__ApiKey` to the same secret used in `infra/.env`.

The stack builds all supported runner images into the sibling daemon before starting the execution service. If you remove runner images while keeping the Compose stack up, rerun the builder with `docker compose --env-file infra/.env -f infra/docker-compose.yml run --rm runner-images`.

The sibling daemon has a separate persistent Docker data volume and its API is available only on an internal Compose network. Source files use a shared, size-limited temporary volume so the execution service and sibling daemon can both access them; normal job cleanup removes each job directory. `docker compose down` stops the stack while preserving Redis data and runner image cache.

### Docker access and isolation tradeoff

The execution service does not mount `/var/run/docker.sock` from the host. It talks to a sibling Docker-in-Docker daemon over a private Compose network. The sibling daemon has its own image store, and the daemon API on port 2375 is not published to the host. The execution service and daemon share a size-limited temporary volume because the inner daemon needs to read each job's source file when it starts a runner container.

Docker-in-Docker must run privileged to start nested containers. That gives it elevated access to the host kernel, so a Docker or kernel vulnerability could cross the boundary. This is a compromise that avoids handing the execution service direct access to the host Docker socket; it is not complete isolation and is not suitable as is for a public multi-tenant execution service. Keep port 2375 private and do not expose this development stack to untrusted networks. A narrowly allow-listed Docker socket proxy is another deployment option, but do not mount the raw host Docker socket into the execution service.

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

The editor Run button compiles or runs the active source file and streams output progressively to the terminal. Supported standalone source extensions are JavaScript (`.js`, `.mjs`, `.cjs`), TypeScript (`.ts`, `.mts`, `.cts`), Python (`.py`, `.pyw`), C# (`.cs`), C (`.c`), C++ (`.cc`, `.cpp`, `.cxx`), Rust (`.rs`), and Java (`.java`). C# and Java sources should contain a single program; Java must declare its entry-point class as `Main`. TypeScript and Rust use their compiler with standard libraries only; external packages are unavailable because runner containers have no network access. JSX/TSX and HTML/CSS are not standalone terminal targets; use the live preview for browser code.

Each runner gets a bounded writable `/runner` tmpfs for compiler output, while the mounted source remains read-only. Compilation and execution share the container limits: 512 MiB memory, one CPU, 30 seconds, 128 MiB writable build space, a separate 10 MiB no-exec `/tmp`, 64 KiB source/output caps, and no network. Adjust these defaults in `ResourceLimits` if the host needs a tighter resource budget.

Submit a job with `POST /api/executions` and JSON fields `roomId`, `requestedBy`, `language` (`JavaScript`, `TypeScript`, `Python`, `CSharp`, `C`, `Cpp`, `Rust`, or `Java`), and `source`. The response includes a job ID and approximate queue position. Poll `GET /api/executions/{jobId}` for `pending`, `running`, `completed`, or `failed` status and the bounded output accumulated so far. When submitted through the room server, output and completion events are also streamed to connected clients over SignalR.

## Monitoring

At Information level, each completed execution logs its room ID, language, duration, exit code, timeout status, and whether the output limit was reached. Failed and cancelled jobs log the same fields where available. `ContainerLifecycle` logs the total and running count of labeled execution containers at startup and every five minutes, so container counts can be compared over time to spot cleanup problems. Orphaned containers and cleanup sweep failures are logged separately.

## Validate

Run unit tests:

```powershell
dotnet test execution-service.tests/Syncode.ExecutionService.Tests.csproj
```

With Docker available and all runner images built, enable container integration checks:

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
