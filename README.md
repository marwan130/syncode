# Syncode

Syncode is a browser IDE where people edit and run the same project together in a room. The browser connects to a .NET room server. Redis holds room state, and the execution service runs terminals and language tools in Docker containers.

## What it includes

- Collaborative text editing and a shared file tree with offline edit recovery
- Participant presence, room roles, join approval, and admin controls
- Monaco editing, language-server diagnostics, a shared Bash terminal, and browser preview
- GitHub import and push, branch management, commit history, and file diffs
- Local folder import and project export

## Run locally with Docker Compose

Install Docker Desktop and switch it to Linux containers. 

```powershell
docker compose --env-file infra/.env -f infra/docker-compose.local.yml up --build -d
```

Check the running services with this command.

```powershell
docker compose --env-file infra/.env -f infra/docker-compose.local.yml ps
```

Stop the stack when you are done.

```powershell
docker compose --env-file infra/.env -f infra/docker-compose.local.yml down
```

This keeps the Redis data and built runner images for your next run. The app, Redis, and execution API bind to loopback. The local stack uses a privileged nested Docker service to run code containers.

GitHub sign-in uses the OAuth values in `infra/.env`. 

## Project layout

- `client` contains the React and Monaco browser app
- `server` contains the room API, SignalR hubs, and room coordination
- `server/Application` contains application contracts and workflows
- `execution-service` runs terminals, language servers, and code in Docker containers
- `infra/docker-compose.local.yml` starts the local development stack

For runner limits, supported languages, and isolation details, see [the execution service README](execution-service/README.md).

## License

Syncode is available under the MIT License. See [LICENSE](LICENSE) and [third-party notices](client/THIRD-PARTY-NOTICES.md) for included assets and dependency licenses.
