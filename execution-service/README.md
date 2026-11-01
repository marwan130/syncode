# Syncode execution service

The execution service is an internal .NET host. It starts interactive Bash terminals and language-server sessions in isolated containers. When run directly, its HTTP host binds to loopback on port 5112. The worker Compose file binds it to the worker's WireGuard address instead.

Production execution requires `ExecutionService__Enabled=true` and `ExecutionService__ContainerRuntime=runsc`. At startup, the service checks that Docker advertises runsc and launches a bounded smoke container. It refuses to start if either check fails. Configure runsc on the worker's Docker daemon and preload the runner images. The execution worker runs on a dedicated Linux VM, separate from the public app host. Its API is reachable only over a private network, and its Docker API uses a local Unix socket.

Install gVisor using its [official installation guide](https://gvisor.dev/docs/user_guide/install/) and configure the Docker daemon with the [official Docker runtime guide](https://gvisor.dev/docs/user_guide/quick_start/docker/). Pin the tested gVisor release in the worker image or host provisioning. The CI adversarial check currently pins release `20261005`.

## Build runner images

Run from the repository root on the Linux worker after configuring Docker with runsc.

```bash
bash infra/build-runner-images.sh
```

TypeScript uses the Node image and its pinned TypeScript compiler. The Java image includes Maven 3.10 and Gradle 9.8 for project-aware builds. The C and C++ images include CMake for projects that use it. The service uses `--pull=never`. Build or deploy these reviewed images ahead of time instead of allowing runtime image pulls.

## Registry-limited package egress

Package egress is disabled by default. Enabling it requires the `runsc` runtime and the package proxy image built by `infra/build-runner-images.sh`.

Set `EXECUTION_CONTAINER_RUNTIME=runsc` and `PACKAGE_EGRESS_ENABLED=true` only on a dedicated Linux worker with Docker Engine 28 or later that has passed the gVisor checks. The execution service starts the proxy on its private egress network. Each interactive terminal gets an isolated internal network with no host gateway and can reach only that proxy. Active-file runs use the terminal's network policy and stay offline when package egress is disabled.

The proxy permits registry domains listed in `RunnerImages/squid.conf` and `RunnerImages/dnsmasq.conf`, blocks private and link-local destinations, and limits download bandwidth. Review the allowlist whenever a package manager needs another registry. Package scripts can still send project data to an allowed registry, so package egress increases supply-chain and data-exfiltration risk. Keep it disabled on development machines and until the worker has passed the egress isolation workflow.

## Start locally

Start a Redis instance that is dedicated to Syncode or point `Redis` at your existing Syncode Redis instance, then run the following commands.

```powershell
$env:Redis = "localhost:6380"
$env:SYNCODE_EXECUTION_API_KEY = "replace-with-a-long-random-local-secret"
dotnet run --project execution-service/Syncode.ExecutionService.csproj
```

The API key is required at startup. Internal callers send it in the `X-Execution-Service-Key` header. Set `ExecutionService__Urls` only when deployment requires another internal bind address. Do not expose this service to the public internet.

## Deploy the execution worker

The worker Compose file runs only the execution service. It does not start Redis, the room server, the client, or a nested Docker daemon. The app host runs Redis and the room server. Connect both hosts over WireGuard or an equivalent private network.

On the worker, install Docker Engine 28 or later, Docker Compose, and gVisor. Follow the [gVisor install guide](https://gvisor.dev/docs/user_guide/install/) and [Docker runtime guide](https://gvisor.dev/docs/user_guide/quick_start/docker/). Confirm `docker info --format '{{json .Runtimes}}'` lists `runsc`. Do not configure a public Docker TCP listener.

Create `/etc/syncode/worker.env` outside the repository and restrict it to its owner. Set `EXECUTION_BIND_IP` to the worker's WireGuard address, `SYNCODE_REDIS_PRIVATE_ENDPOINT` to the app host's WireGuard address with port `6379`, and `SYNCODE_REDIS_PASSWORD` to the same Redis password used by the app stack. Set `SYNCODE_EXECUTION_API_KEY` to the same random secret used by the room server. Both secrets must contain at least 32 bytes. Set `DOCKER_GID` to the group ID of `/var/run/docker.sock` and `EXECUTION_SOURCE_PATH` to an absolute path such as `/var/lib/syncode/execution-source`.

Mount a size-limited 1 GiB filesystem at the source path on the worker and grant it to the execution-service identity. Add the mount to `/etc/fstab` so it returns after a reboot.

```bash
sudo install -d -o 10001 -g 10001 -m 0750 /var/lib/syncode/execution-source
echo 'tmpfs /var/lib/syncode/execution-source tmpfs rw,nosuid,nodev,size=1g,mode=0750,uid=10001,gid=10001 0 0' | sudo tee -a /etc/fstab
sudo mount /var/lib/syncode/execution-source
stat -c '%g' /var/run/docker.sock
```

Use the reported socket group ID for `DOCKER_GID`. Run the image build command from the previous section on the worker, then start the service from the repository root.

```bash
docker compose --env-file /etc/syncode/worker.env -f infra/docker-compose.execution-worker.yml up --build -d
```

The service uses the worker host's network namespace and binds port 5112 only to `EXECUTION_BIND_IP`. The worker firewall must allow that port only from the app host's WireGuard address. Allow Redis traffic from the worker to the app host on port 6379. Deny other worker egress, except package-proxy traffic you explicitly enable. Keep the Docker socket local and do not publish it over TCP. The service process has root-equivalent authority through that socket, so the VM must not host unrelated workloads or sensitive host data. The mounted workspace and dependency cache use the size-limited tmpfs and are cleared by a worker host reboot.

The room server calls the worker over WireGuard with the shared API key. The public app Compose stack binds the client to loopback and publishes Redis only on the app host's WireGuard address. Follow the root README for the app host setup and firewall rules.

The same builder creates the Bash image for interactive terminal tabs. Each tab runs a separate Bash process with 512 MiB of memory, half a CPU, 64 processes, 256 open files, a 32 MiB room snapshot, a 128 MiB workspace disk cap, and a 256 KiB output cap. Networking is off by default. When package egress is enabled, the terminal can reach only the restricted proxy. The service allows three terminal sessions per SignalR connection, four per room, and eight per execution-service instance. It closes a session when its tab or room connection closes, after 15 minutes of inactivity, or after one hour. A terminal starts from the room snapshot and sends file changes back through the shared document state. Generated files and dependencies stay outside that state. Active-file runs use the same terminal, so program output and input stay together.

The terminal image includes Node.js 24 with npm, pnpm, and Yarn, Python 3.12 with pip, .NET SDK 10 with NuGet, Rust 1.99 with Cargo, GCC and G++ with CMake, Conan 2.33, Java 21, Maven 3.10, and Gradle 9.8. Each room has a separate 256 MiB dependency cache. Build output stays in the terminal's private workspace and is not sent to collaborators. Put `EXECUTION_SOURCE_PATH` on a size-limited 1 GiB filesystem. Each terminal workspace also has a 128 MiB disk cap.

The browser terminal runs interactive Bash through a pseudo-terminal, including command history, cursor editing, and job control. The panel can be resized, but terminal size changes are not sent to the shell, so full-screen programs that depend on terminal dimensions may not work properly.

Each execution session receives a separate temporary workspace on the worker. The host Docker daemon bind-mounts that same host path into the runner container. Session cleanup removes its workspace.

### Docker access and isolation tradeoff

The worker does not run Docker-in-Docker. The execution service uses the worker's Unix socket to start containers, and Docker has no published TCP API. The socket still grants broad control of the worker host. A compromise of the execution service could use that socket to start containers outside Syncode's runner policy, so gVisor does not replace isolating the worker VM. Keep the worker dedicated to Syncode, restrict its network with host firewall rules, and require runner containers to use `runsc`.

## Connect it to the Syncode room server

Run the execution service and room server with the same Redis connection and execution API key. The room server relays terminal input and output through its SignalR hub and keeps the execution service API key server-side.

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
dotnet run --project server/Syncode.Server.csproj --launch-profile http
```

The editor Run button uses the active Bash terminal to compile or run the active source file. Output appears in the same terminal and interactive input goes to the running program. Supported standalone source extensions are JavaScript (`.js`, `.mjs`, `.cjs`), TypeScript (`.ts`, `.mts`, `.cts`), Python (`.py`, `.pyw`), C# (`.cs`), C (`.c`), C++ (`.cc`, `.cpp`, `.cxx`), Rust (`.rs`), and Java (`.java`). JSX/TSX and HTML/CSS are not standalone terminal targets. Use the live preview for browser code.

When the workspace contains a supported project manifest, the runner entrypoint uses the project build tool instead of compiling a standalone file. It detects `.csproj` for C#, `Cargo.toml` for Rust, `pom.xml`, `build.gradle`, or `build.gradle.kts` for Java, and `CMakeLists.txt` or `Makefile` for C and C++. JavaScript, TypeScript, and Python run the selected file directly and do not invoke `package.json` or `requirements.txt` scripts. Dependencies installed in the terminal are available to supported project builds through room-scoped dependency storage mounted read-only at `/deps`. C# resolves NuGet packages cached by `dotnet restore`. Rust builds with `cargo build --offline` using the Cargo registry populated in the terminal. Java builds offline with Maven or Gradle using cached repositories. When no supported manifest is found, each language uses its standalone-file path. Use the Bash terminal for dependency installation, interactive builds, test commands, and workflows that need network access.

Active-file runs share the terminal's container limits, package access policy, workspace, and bounded output. The runner entrypoint uses a writable 256 MiB `/runner` tmpfs for compiler output. Keep the Docker API private and enable gVisor for production execution.

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

## Project build and test commands

The terminal runs in the root of the shared project snapshot. Use the project's own manifest and lockfile when present. For example, run `npm install` and `npm test`, `pip install -r requirements.txt` and `python -m pytest`, `dotnet restore` and `dotnet test`, `cargo test`, `mvn test`, or `gradle test`. For C and C++, use the project's CMake or Make configuration with Conan when dependencies are declared there. Commands run only after a participant starts them. Ctrl+C stops the foreground command, rerunning a command stays in the same terminal session, and terminal output is capped.

Registry egress is disabled by default. Enabling it requires the `runsc` runtime and the package proxy image built by `infra/build-runner-images.sh`. Set `EXECUTION_CONTAINER_RUNTIME=runsc` and `PACKAGE_EGRESS_ENABLED=true` only on a dedicated Linux worker that has passed the egress isolation workflow. Each terminal joins a private internal network and can reach only the restricted proxy. The proxy permits the package registries configured in `RunnerImages/squid.conf`, blocks private and local destinations, and limits download bandwidth. With egress disabled, terminals have no network and active-file runs can read installed packages only from the room dependency store.

Package scripts are executable untrusted code. They can send project data to an allowed registry, so imported code and dependencies remain a supply-chain and data-exfiltration risk. Keep egress disabled on development machines and until the worker has passed the gVisor isolation workflow.

## Language intelligence

The editor uses Monaco's built-in workers for JavaScript, TypeScript, and CSS. Isolated language-server containers provide HTML diagnostics, Pyright for Python, csharp-ls for C#, clangd for C and C++, rust-analyzer for Rust, and Eclipse JDT LS for Java.

The room server creates a short-lived session only after confirming that the requesting SignalR connection is a current room participant. It materializes the room workspace, sends it to the execution service over its private authenticated API, and issues a one-use WebSocket ticket bound to that room connection. The browser never receives the execution-service API key. The ticket expires after one minute. Each SignalR connection can hold up to eight sessions. The execution service allows eight language-server containers per room and 16 per instance by default. The instance limit can be adjusted with `ExecutionService__MaxLanguageServerSessions`.

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

The Docker checks run supported languages in standalone mode and exercise project builds for C#, Rust, Java with Maven, and C with CMake. They also verify timeout, network isolation, and the `/tmp` size limit. The unit tests check project-manifest routing for Cargo, .NET, Maven, and CMake.

For the adversarial isolation check, configure Docker with gVisor and build the C runner image. Then run the following command.

```powershell
$env:SYNCODE_RUN_GVISOR_INTEGRATION = "1"
dotnet test execution-service.tests/Syncode.ExecutionService.Tests.csproj --filter "Category=GVisorIntegration"
```

This check attempts to write to the container root and source mount, access the Docker socket, mount a filesystem, and execute from the no-exec temporary directory. It also checks the runtime identity, effective capabilities, and no-new-privileges state. It requires an actual Linux Docker daemon with `runsc` configured. A passing unit test alone does not verify that host configuration.

The `Execution isolation` GitHub Actions workflow runs execution-service unit tests, checks NuGet advisories, builds runner images, and runs container integration and adversarial isolation checks under a pinned gVisor release. Require the workflow's required checks in branch protection before accepting a production release.
