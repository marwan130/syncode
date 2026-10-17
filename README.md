# Syncode

Syncode is a browser-based real-time collaborative code editor.

## System Architecture

![Syncode System Architecture](docs/syncode_architecture.drawio.png)

## Scaling deployment

The client is a static Vite build and can be served from a CDN. Multiple room-server instances can share the same Redis deployment. Redis stores room state, capacity and rate-limit data, while the SignalR Redis backplane distributes hub broadcasts. Keep the Redis connection, room-capacity settings, allowed origins, execution-service URL, API key, and execution queue prefix consistent across instances.

The load balancer must support WebSockets and preserve SignalR session affinity while clients negotiate and connect. The client uses SignalR negotiation, so a Redis backplane alone does not replace affinity. Configure load-balancer health probes against a health/readiness endpoint provided by the deployment. The room server does not currently expose a dedicated health endpoint.

Execution output is published through Redis Pub/Sub. Room-server instances elect one output relay at a time using a short Redis lease, then send each event through the SignalR backplane. This avoids every server broadcasting the same event. Execution workers can share the same Redis queue and scale independently.

Interactive terminal sessions are currently owned by the room-server connection that created them. They work across a multi-instance deployment when SignalR affinity holds, but an instance restart or connection replacement does not restore an open shell. Room documents and room membership are Redis-backed and can be reloaded after reconnect.

