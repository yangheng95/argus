---
name: delivery-verify-api
description: Backend API verification — endpoints, auth flow, error handling, content types
stage: delivery
auto_detect:
  deps: ["hono", "express", "fastify", "koa", "@nestjs/core"]
priority: 5
required_tools:
  - run_command
---

## API delivery verification — contract

Every endpoint the task spec lists must be invoked at least once during
delivery, with `run_command` capturing the request + response, and the result
cited in `tool_call_evidence[]`. Reading the handler code is NOT a substitute
for a real HTTP round-trip.

### Required flow

1. `run_command` to start the server (`bun run start` or the project's
   equivalent). Confirm a listening address before continuing.

2. For EVERY endpoint the spec describes, `run_command` with
   `curl -sD- -o /dev/null -w '%{http_code} %{content_type}\n' ...`
   (or the platform equivalent) to capture status + content-type in one line.
   Bundle the whole round-trip into a single evidence entry per endpoint.

3. Happy path, then at least one error path per endpoint:
   - Missing body on a POST: expect 4xx with `application/json` body
   - Unauthenticated request to a protected route: expect 401
   - Unknown route: expect 404 with JSON, not HTML

4. Authentication flow when the app has auth:
   - Register → returns token
   - Protected endpoint without token → 401
   - Protected endpoint with token → 200
   - Protected endpoint with malformed token → 401 (not 500)

### tool_call_evidence entries

One entry per `run_command` invocation that was part of verification. The
`detail` field must carry the literal status + content-type + response-body
prefix, not prose:

```
detail: "GET /api/stocks/AMD → 200 application/json, body[0:80]='{\"symbol\":\"AMD\",\"price\":124.52,...'"
```

### Common real failures this skill catches

- JSON endpoint returns `text/plain` — frontend fetch().json() explodes
- 404 returns HTML — SPA fallback leaked into `/api/*`
- 500 leaks stack trace with file paths — security regression
- Auth returns 200 on bad token — middleware not wired

Do NOT stop at reading the handler code. Populate `tool_call_evidence` with
real `run_command` output or submit_verdict will reject the accepted verdict.
