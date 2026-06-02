# Add a `/health` endpoint to the API

## Context

Operations needs a cheap, dependency-free way to check that the service is up. There is no
liveness endpoint today, so the uptime monitor falls back to hitting `/` — which renders the
full home page and skews the latency graphs.

## Approach

Add a single `GET /health` route that returns `200 OK` with a small JSON body. It touches no
database and holds no locks, so it stays fast even when the rest of the app is under load. The
route mirrors the existing router registration pattern, so nothing new is introduced beyond the
handler itself.

The handler reads the process uptime, serializes it, and returns:

```ts
// routes/health.ts — liveness only, no dependency probing
import type { Request, Response } from "express";

const startedAt = Date.now();

export function health(_req: Request, res: Response): void {
  const uptime = Math.floor((Date.now() - startedAt) / 1000);
  res.json({ status: "ok", uptime });
}
```

The response body the monitor parses:

```json
{
  "status": "ok",
  "uptime": 1287
}
```

## Steps

- Register `GET /health` in the router alongside the existing routes:

```diff
   router.get("/", home);
   router.get("/login", login);
+  router.get("/health", health);
```

- Return `{ "status": "ok", "uptime": <seconds> }` with `Content-Type: application/json`.
- Exclude `/health` from request logging so the monitor's once-a-second poll doesn't drown the logs.
- Add a test asserting a `200` and the `status: "ok"` field.

Smoke-test it locally once the route is wired up:

```sh
# expect a 200 and {"status":"ok",...}
curl -s localhost:3000/health | jq .status
```

## Out of scope

Readiness checks (dependency probing for the database and cache) are a follow-up — this change
is liveness only.
