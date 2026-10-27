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

TypeScript uses the Node image and its pinned TypeScript compiler. The Java image includes Maven 3.10 and Gradle 9.8 for project-aware builds. The C and C++ images include CMake for projects that use it. The service uses `--pull=never`. Build or deploy these reviewed images ahead of time instead of allowing runtime image pulls.

## Registry-limited package egress

Package egress is disabled by default. Enabling it requires the `runsc` runtime and the package proxy image built by `infra/build-runner-images.sh`.

Set `EXECUTION_CONTAINER_RUNTIME=runsc` and `PACKAGE_EGRESS_ENABLED=true` only on a dedicated Linux worker with Docker Engine 28 or later that has passed the gVisor checks. The execution service starts the proxy on its private egress network. Each interactive terminal gets an isolated internal network with no host gateway and can reach only that proxy. One-shot code runs keep `--network=none`.

The proxy permits registry domains listed in `RunnerImages/squid.conf` and `RunnerImages/dnsmasq.conf`, blocks private and link-local destinations, and limits download bandwidth per isolated session network. The allowlist must be reviewed whenever a package manager needs another registry. Package scripts can still send project data to an allowed registry, so package egress increases supply-chain and data-exfiltration risk. Keep it disabled on development machines and until the worker has passed the egress isolation workflow.

## Start locally

Start a Redis instance that is dedicated to Syncode or point `Redis` at your existing Syncode Redis instance, then run the following commands.

```powershell
$env:Redis = "localhost:6380"
$env:SYNCODE_EXECUTION_API_KEY = "replace-with-a-long-random-local-secret"
dotnet run --project execution-service/Syncode.ExecutionService.csproj
```

The API key is required at startup. Internal callers send it in the `X-Execution-Service-Key` header. Set `ExecutionService__Urls` only when deployment requires another internal bind address. Do not expose this service to the public internet.

## Run with Docker Compose

The Compose stack starts the browser client, room server, Redis, execution service, a sibling Docker-in-Docker daemon, and a one-shot service that builds the runner images. The client is available at `http://localhost:8080` by default. Redis and the execution API are published on loopback for local development. The full setup and GitHub OAuth configuration are documented in the repository README.

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

The default Redis host port is `6380`, avoiding the common local Redis port `6379`. Change `REDIS_PORT` in `infra/.env` if needed. The service binds to loopback on port 5112. If you run the room server directly on the host, use the Redis host port and set `ExecutionService__BaseUrl` to the loopback HTTP address on port 5112. Set `ExecutionService__ApiKey` to the same secret used in `infra/.env`.

The stack builds all supported runner images into the sibling daemon before starting the execution service. The one-shot image builder uses Docker's classic builder because BuildKit's nested DNS resolver can fail to resolve Docker Hub from Docker-in-Docker on some Docker Desktop setups. If you remove runner images while keeping the Compose stack up, rerun the builder with `docker compose --env-file infra/.env -f infra/docker-compose.yml run --rm runner-images`.

The same builder creates the Bash image used by interactive terminal tabs. Each tab runs its own Bash process in a no-network container with 512 MiB memory, half a CPU, 64 processes, 256 open files, a 32 MiB shared room snapshot, a 128 MiB workspace disk cap, and a 256 KiB output cap. Sessions are limited to three per SignalR connection and eight per execution-service instance, close when their tab or room connection closes, and expire after inactivity or one hour. A terminal starts from the room snapshot and sends file changes back through the room's shared document state. Generated and dependency paths stay outside that shared state.

The terminal image includes Node.js 24 with npm, pnpm, and Yarn, Python 3.12 with pip, .NET SDK 10 with NuGet, Rust 1.99 with Cargo, GCC and G++ with CMake, Conan 2.33, Java 21, Maven 3.10, and Gradle 9.8. Package caches and installed packages live in room-scoped dependency storage, separate from the shared project files. Build output remains in each terminal's private workspace and is not sent to collaborators. Room dependency storage is capped at 256 MiB and the Compose workspace volume has a 1 GiB global cap.

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

The editor Run button compiles or runs the active source file and streams output progressively to the terminal. Supported standalone source extensions are JavaScript (`.js`, `.mjs`, `.cjs`), TypeScript (`.ts`, `.mts`, `.cts`), Python (`.py`, `.pyw`), C# (`.cs`), C (`.c`), C++ (`.cc`, `.cpp`, `.cxx`), Rust (`.rs`), and Java (`.java`). Run jobs remain network-isolated. JSX/TSX and HTML/CSS are not standalone terminal targets. Use the live preview for browser code.

When the workspace contains a project manifest, Run uses the project build tool instead of compiling a standalone file. Dependencies installed in the terminal are available to the build through the room-scoped dependency storage mounted read-only at `/deps`. C# detects `.csproj` files and resolves NuGet packages cached by `dotnet restore` in the terminal. Rust detects `Cargo.toml` and builds with `cargo build --offline` using the Cargo registry populated by `cargo add` or `cargo build` in the terminal. Java detects `pom.xml` for Maven (`mvn -o compile`) or `build.gradle` for Gradle (`gradle --offline compileJava`), both using cached repositories from terminal dependency installation. C and C++ detect `CMakeLists.txt` for CMake builds or `Makefile` for Make builds. When no manifest is found, each language falls back to the standalone single-file compiler path. Use the Bash terminal for dependency installation, interactive builds, test commands, and any workflow that requires network access.

Each runner gets a bounded writable 128 MiB `/runner` tmpfs for compiler output, while the mounted source remains read-only. Compilation and execution share the container limits. JavaScript, TypeScript, Python, C, C++, Rust, and Java use 512 MiB memory. C# uses 4 GiB to bound SDK restore and compilation of submitted source. All runners share one CPU, a 30-second timeout, 64 processes, 256 open files, a separate 10 MiB no-exec `/tmp`, a 32 MiB project source cap, a 64 KiB output cap, and no network. File writes are capped at 16 MiB for most runners and 128 MiB for C# to allow bounded SDK intermediates. C# uses a 128-process cap for SDK and compiler overhead. The shared temporary volume is capped at 1 GiB. Adjust these defaults in `ResourceLimits` if the host needs a tighter resource budget.

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

## Contributing changes

Keep request validation at the API boundary and container policy in the runner. When adding a language, update its runner image, the image build script, the entrypoint, language detection, resource limits, and the container integration checks together. Rebuild the runner images after changing a toolchain or language server. Keep the setup and security notes here aligned with the shipped configuration.

Run the client lint, format, test, and build commands from the repository README. Run the execution-service unit tests before opening a pull request. Docker integration checks need a local Docker daemon, and the gVisor checks need a Linux daemon configured with `runsc`.

The queue prefix can be changed with `ExecutionService__QueuePrefix` when the service shares a Redis database with another deployment.

## Project build and test commands

The terminal runs in the root of the shared project snapshot. Use the project's own manifest and lockfile when present. For example, run `npm install` and `npm test`, `pip install -r requirements.txt` and `python -m pytest`, `dotnet restore` and `dotnet test`, `cargo test`, `mvn test`, or `gradle test`. For C and C++, use the project's CMake or Make configuration with Conan when dependencies are declared there. Commands run only after a participant starts them. Ctrl+C stops the foreground command, rerunning a command stays in the same terminal session, and terminal output is capped.

Registry egress is disabled by default. Enabling it requires the `runsc` runtime and the package proxy image built by `infra/build-runner-images.sh`. Set `EXECUTION_CONTAINER_RUNTIME=runsc` and `PACKAGE_EGRESS_ENABLED=true` only on a dedicated Linux worker that has passed the egress isolation workflow. Each terminal joins a private internal network and can reach only the restricted proxy. The proxy permits the package registries configured in `RunnerImages/squid.conf`, blocks private and local destinations, and limits download bandwidth. Run jobs stay on `--network=none` and can only read installed packages from the room dependency store.

Package scripts are executable untrusted code. They can send project data to an allowed registry, so imported code and dependencies remain a supply-chain and data-exfiltration risk. Keep egress disabled on development machines and until the worker has passed the gVisor isolation workflow.

## Language intelligence

The editor uses Monaco's TypeScript worker for JavaScript and TypeScript. Isolated language-server containers provide HTML and CSS services, Pyright for Python, csharp-ls for C#, clangd for C and C++, rust-analyzer for Rust, and Eclipse JDT LS for Java.

The room server creates a short-lived session only after confirming that the requesting SignalR connection is a current room participant. It materializes the room workspace, sends it to the execution service over its private authenticated API, and issues a one-use WebSocket ticket bound to that room connection. The browser never receives the execution-service API key. The ticket expires after one minute. Each SignalR connection can hold up to four sessions. The execution service allows eight language-server containers by default and can be adjusted with `ExecutionService__MaxLanguageServerSessions`.

Each container runs under the restricted runner identity with a read-only workspace and dependency cache, no network, dropped capabilities, no-new-privileges, a read-only root filesystem, bounded memory, CPU, process count, temporary storage, and a 30-minute maximum lifetime. Language-server processes receive no platform credentials. The room client sends document open, change, and close notifications from the shared CRDT state. Diagnostics, completions, hover results, definitions, document symbols, and formatting are mapped to Monaco. A language-server failure stays isolated from collaboration and editing.

The language-server binaries are installed in the existing per-language runner images. The Node image pins the extracted HTML and CSS servers to 4.10.0 and Pyright to 1.1.414. The .NET image pins csharp-ls to 0.28.0. The Java image uses Eclipse JDT LS 1.64.0-202610221949 and verifies its downloaded archive against the published SHA-256 file. Rebuild the images after changing a server version with `infra/build-runner-images.sh`.

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

The Docker checks run all supported languages in both standalone and project-aware modes, and verify timeout, network isolation, and the `/tmp` size limit. Project-aware tests verify that Cargo.toml, .csproj, and CMakeLists.txt manifests trigger the correct build tool path.

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
