# Syncode execution service

The execution service is an internal .NET host. It accepts authenticated execution requests, stores them in a bounded Redis list, and runs up to three jobs concurrently in isolated containers. Repeated requests with the same room and request ID resolve to the original job, preventing client retries from enqueuing duplicate work. By default, the HTTP host binds to loopback on port 5112.

Production execution requires `ExecutionService__Enabled=true` and `ExecutionService__ContainerRuntime=runsc`. The service checks that the Docker daemon advertises runsc and starts a bounded smoke container during startup, then refuses to start if either check fails. Configure runsc on the Docker daemon that the service uses and preload the runner images. The Compose stack below is for local development only because its Docker-in-Docker service is privileged. Deploy the execution service only on a dedicated Linux worker host with a private Docker API and network access restricted to the room server and Redis.

Install gVisor using its [official installation guide](https://gvisor.dev/docs/user_guide/install/) and configure the Docker daemon with the [official Docker runtime guide](https://gvisor.dev/docs/user_guide/quick_start/docker/). Pin the tested gVisor release in the worker image or host provisioning. The CI adversarial check currently pins release `20261005`.

## Build runner images

Run from the repository root with Docker Desktop using Linux containers.

```powershell
docker build -t syncode-runner-node -f execution-service/Runner/RunnerImages/Dockerfile.node execution-service/Runner/RunnerImages
docker build -t syncode-runner-python -f execution-service/Runner/RunnerImages/Dockerfile.python execution-service/Runner/RunnerImages
docker build -t syncode-runner-dotnet -f execution-service/Runner/RunnerImages/Dockerfile.dotnet execution-service/Runner/RunnerImages
docker build -t syncode-runner-c --build-arg RUNNER_RUNTIME=c -f execution-service/Runner/RunnerImages/Dockerfile.native execution-service/Runner/RunnerImages
docker build -t syncode-runner-cpp --build-arg RUNNER_RUNTIME=cpp -f execution-service/Runner/RunnerImages/Dockerfile.native execution-service/Runner/RunnerImages
docker build -t syncode-runner-rust -f execution-service/Runner/RunnerImages/Dockerfile.rust execution-service/Runner/RunnerImages
docker build -t syncode-runner-java -f execution-service/Runner/RunnerImages/Dockerfile.java execution-service/Runner/RunnerImages
docker build -t syncode-runner-bash -f execution-service/Runner/RunnerImages/Dockerfile.bash execution-service/Runner/RunnerImages
```

TypeScript uses the Node image and its pinned TypeScript compiler. The service uses `--pull=never`. Build or deploy these reviewed images ahead of time instead of allowing runtime image pulls.

## Start locally

Start a Redis instance that is dedicated to Syncode or point `Redis` at your existing Syncode Redis instance, then run the following commands.

```powershell
$env:Redis = "localhost:6380"
$env:SYNCODE_EXECUTION_API_KEY = "replace-with-a-long-random-local-secret"
dotnet run --project execution-service/Syncode.ExecutionService.csproj
```

The API key is required at startup. Internal callers send it in the `X-Execution-Service-Key` header. Set `ExecutionService__Urls` only when deployment requires another internal bind address. Do not expose this service to the public internet.

## Run with Docker Compose

The Compose stack runs the execution service, its Redis instance, a sibling Docker-in-Docker daemon, and a one-shot service that builds all supported runner images. It does not start the Syncode room server or client. The execution API and Redis are published only on loopback so a separately run local room server can connect to them.

From the repository root, create `infra/.env` if it does not exist. Set `SYNCODE_EXECUTION_API_KEY` to at least 32 random bytes, and set `REDIS_PORT` if the default port is unavailable. Keep this file private, then start the stack.

```powershell
notepad infra/.env
docker compose --env-file infra/.env -f infra/docker-compose.yml up --build
```

Docker Desktop must be running with its Linux container engine before starting Compose. If startup stops while pulling a runner base image with a DNS lookup error, check that Docker Desktop has working internet access, then retry the Compose command. You can stop and recreate this stack without deleting its Redis data or runner image cache with the following command.

```powershell
docker compose --env-file infra/.env -f infra/docker-compose.yml down
docker compose --env-file infra/.env -f infra/docker-compose.yml up --build
```

The default Redis host port is `6380`, avoiding the common local Redis port `6379`. Change `REDIS_PORT` in `infra/.env` if needed. The service binds to loopback on port 5112. To connect a room server running directly on the host, use the Redis host port 6380 and set `ExecutionService__BaseUrl` to the loopback HTTP address on port 5112. Set `ExecutionService__ApiKey` to the same secret used in `infra/.env`.

The stack builds all supported runner images into the sibling daemon before starting the execution service. The one-shot image builder uses Docker's classic builder because BuildKit's nested DNS resolver can fail to resolve Docker Hub from Docker-in-Docker on some Docker Desktop setups. If you remove runner images while keeping the Compose stack up, rerun the builder with `docker compose --env-file infra/.env -f infra/docker-compose.yml run --rm runner-images`.

The same builder creates the Bash image used by interactive terminal tabs. Each tab runs its own Bash process in a no-network container with 256 MiB memory, half a CPU, 32 processes, 256 open files, a 32 MiB shared room snapshot, a 64 MiB disk cap, and a 256 KiB output cap. Sessions are limited to three per SignalR connection and eight per execution-service instance, close when their tab or room connection closes, and expire after inactivity or one hour. A terminal starts from the room snapshot and sends file changes back through the room's shared document state. Generated and dependency paths stay outside that shared state.

The browser terminal runs interactive Bash through a pseudo-terminal, including command history, cursor editing, and job control. Terminal resizing and full-screen programs are not supported yet.

The sibling daemon has a separate persistent Docker data volume and its TLS-authenticated API is available only on an internal Compose network. Source files use a shared, size-limited temporary volume so the execution service and sibling daemon can both access them. Normal job cleanup removes each job directory. `docker compose down` stops the stack while preserving Redis data and runner image cache.

### Docker access and isolation tradeoff

The local development stack does not mount `/var/run/docker.sock` from the host. It talks to a sibling Docker-in-Docker daemon over a private Compose network using client certificates. The sibling daemon has its own image store, and its TLS API on port 2376 is not published to the host. The execution service and daemon share a size-limited temporary volume because the inner daemon needs to read each job's source file when it starts a runner container.

Docker-in-Docker must run privileged to start nested containers. That gives it elevated access to the host kernel, so this development stack is not suitable for a public multi-tenant deployment. Production runner containers must use gVisor and keep `--network=none`, dropped capabilities, non-root users, read-only source mounts, and resource limits. The production Docker API must remain private and must never be exposed to room participants.

Execution submissions are limited to 10 per room per rolling minute by default. Excess submissions receive HTTP `429 Too Many Requests`, a `Retry-After` header, and a message suitable for display in the client. Set `ExecutionService__MaxExecutionsPerRoomPerMinute` or `ExecutionService__ExecutionRateWindowMinutes` to adjust the limit. Rate-limit state is shared through Redis across service instances.

## Connect it to the Syncode room server

Run the execution service and room server with the same Redis connection, execution API key, and queue prefix. The execution service publishes stdout, stderr, and completion events through Redis. The room server relays them to the connected room over its existing SignalR hub and keeps the execution service API key server-side.

In the execution-service terminal, run the following commands.

```powershell
$env:Redis = "localhost:6380"
$env:SYNCODE_EXECUTION_API_KEY = "use-the-same-random-secret-in-the-server"
dotnet run --project execution-service/Syncode.ExecutionService.csproj
```

In the room-server terminal, run the following commands.

```powershell
$env:Redis = "localhost:6380"
$env:ExecutionService__BaseUrl = "http://127.0.0.1:5112"
$env:ExecutionService__ApiKey = "use-the-same-random-secret-in-the-execution-service"
$env:ExecutionService__QueuePrefix = "syncode:execution"
dotnet run --project server/Syncode.Server.csproj --launch-profile http
```

The editor Run button compiles or runs the active source file and streams output progressively to the terminal. Supported standalone source extensions are JavaScript (`.js`, `.mjs`, `.cjs`), TypeScript (`.ts`, `.mts`, `.cts`), Python (`.py`, `.pyw`), C# (`.cs`), C (`.c`), C++ (`.cc`, `.cpp`, `.cxx`), Rust (`.rs`), and Java (`.java`). C# and Java sources should contain a single program. Java must declare its entry-point class as `Main`. TypeScript and Rust use their compiler with standard libraries only. External packages are unavailable because runner containers have no network access. JSX/TSX and HTML/CSS are not standalone terminal targets. Use the live preview for browser code.

Each runner gets a bounded writable `/runner` tmpfs for compiler output, while the mounted source remains read-only. Compilation and execution share the container limits. These are 512 MiB memory, one CPU, 30 seconds, 64 processes, 256 open files, a 16 MiB per-file write limit, 128 MiB writable build space, a separate 10 MiB no-exec `/tmp`, a 32 MiB project source cap, a 64 KiB output cap, and no network. The shared temporary volume is capped at 1 GiB. Adjust these defaults in `ResourceLimits` if the host needs a tighter resource budget.

Submit a job with `POST /api/executions` and JSON fields `roomId`, `requestedBy`, `language` (`JavaScript`, `TypeScript`, `Python`, `CSharp`, `C`, `Cpp`, `Rust`, or `Java`), and `source`. The response includes a job ID and approximate queue position. Poll `GET /api/executions/{jobId}` for `pending`, `running`, `completed`, `failed`, or `cancelled` status and the bounded output accumulated so far. When submitted through the room server, output and completion events are also streamed to connected clients over SignalR.

## Monitoring

At Information level, each completed execution logs its room ID, language, duration, exit code, timeout status, and whether the output limit was reached. Failed and cancelled jobs log the same fields where available. `ContainerLifecycle` logs the total and running count of labeled execution and terminal containers at startup and every five minutes, so container counts can be compared over time to spot cleanup problems. Orphaned containers and cleanup sweep failures are logged separately.

## Build

From the repository root, build the .NET services and client with the following commands.

```powershell
dotnet build server/Syncode.Server.csproj
dotnet build execution-service/Syncode.ExecutionService.csproj
cd client
npm run build
```

The queue prefix can be changed with `ExecutionService__QueuePrefix` when the service shares a Redis database with another deployment.

## Validate

Run the unit tests with the following command.

```powershell
dotnet test execution-service.tests/Syncode.ExecutionService.Tests.csproj
```

With Docker available and all runner images built, run the container integration checks with the following command.

```powershell
$env:SYNCODE_RUN_DOCKER_INTEGRATION = "1"
dotnet test execution-service.tests/Syncode.ExecutionService.Tests.csproj
```

The Docker checks run all supported languages and verify timeout, network isolation, and the `/tmp` size limit.

For the adversarial isolation check, configure Docker with gVisor and build the C runner image. Then run the following command.

```powershell
$env:SYNCODE_RUN_GVISOR_INTEGRATION = "1"
dotnet test execution-service.tests/Syncode.ExecutionService.Tests.csproj --filter "Category=GVisorIntegration"
```

This check attempts to write to the container root and source mount, access the Docker socket, mount a filesystem, and execute from the no-exec temporary directory. It also checks the runtime identity, effective capabilities, and no-new-privileges state. It requires an actual Linux Docker daemon with `runsc` configured. A passing unit test alone does not verify that host configuration.

The `Execution isolation` GitHub Actions workflow runs the unit suite and the adversarial gVisor test against a pinned gVisor release for execution-service changes. Require both workflow checks in branch protection before accepting a production release.

With Redis available, run the queue and rate-limiter integration checks with the following command.

```powershell
$env:SYNCODE_REDIS_CONNECTION = "localhost:6380"
dotnet test execution-service.tests/Syncode.ExecutionService.Tests.csproj --filter "Category=RedisIntegration"
```
