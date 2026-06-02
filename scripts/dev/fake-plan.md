# Add a `/health` endpoint to the API

## Context

Operations needs a cheap, dependency-free way to check that the service is up. There is no liveness endpoint today, so the uptime monitor falls back to hitting `/` — which renders the full home page and skews the latency graphs.

## Approach

Add a single `GET /health` route that returns `200 OK` with a small JSON body. It touches no database and holds no locks, so it stays fast even when the rest of the app is under load. The route mirrors the existing router registration pattern, so nothing new is introduced beyond the handler itself.

## Steps

- Register `GET /health` in the router alongside the existing routes.
- Return `{ "status": "ok", "uptime": <seconds> }` with `Content-Type: application/json`.
- Exclude `/health` from request logging so the monitor's once-a-second poll doesn't drown the logs.
- Add a test asserting a `200` and the `status: "ok"` field.

## Out of scope

Readiness checks (dependency probing for the database and cache) are a follow-up — this change is liveness only.
