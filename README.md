# Syncode

Syncode is a browser IDE where people edit and run the same project together in a room. The browser connects to a .NET room server. Redis holds room state, and the execution service runs terminals and language tools in Docker containers.

## What it includes

- Collaborative text editing and a shared file tree with offline edit recovery
- Participant presence, room roles, join approval, and admin controls
- Monaco editing, language-server diagnostics, a shared Bash terminal, and browser preview
- GitHub import and push, branch management, commit history, and file diffs
- Local folder import and project export

## Run locally with Docker Compose

Install Docker Desktop and switch it to Linux containers. Make sure `infra/.env` exists and contains your local settings. 

From the repository root, start the stack.

```powershell
docker compose --env-file infra/.env -f infra/docker-compose.local.yml up --build -d
```

The first start builds the app and execution service, then builds the language runner images inside the nested Docker service. Later starts reuse those images.

Open [http://localhost:8081](http://localhost:8081). The local stack uses the `CLIENT_PORT` value from `infra/.env`, which is `8081`. The room server health endpoint is available at `http://localhost:8081/health`, and the execution service health endpoint is at `http://localhost:5112/health`.

Check the running services with this command.

```powershell
docker compose --env-file infra/.env -f infra/docker-compose.local.yml ps
```

Stop the stack when you are done.

```powershell
docker compose --env-file infra/.env -f infra/docker-compose.local.yml down
```

This keeps the Redis data and built runner images for your next run. The app, Redis, and execution API bind to loopback. The local stack uses a privileged nested Docker service to run code containers, so keep it on your development machine.

GitHub sign-in uses the OAuth values in `infra/.env`. The callback URL should match the local client address, for example `http://localhost:8081/github/callback`.

## Project layout

- `client` contains the React and Monaco browser app
- `server` contains the room API, SignalR hubs, and room coordination
- `server/Application` contains application contracts and workflows
- `execution-service` runs terminals, language servers, and code in Docker containers
- `infra/docker-compose.local.yml` starts the local development stack

For runner limits, supported languages, and isolation details, see [the execution service README](execution-service/README.md).

## License

Syncode is available under the MIT License. See [LICENSE](LICENSE) and [third-party notices](client/THIRD-PARTY-NOTICES.md) for included assets and dependency licenses.
