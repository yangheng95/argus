---
name: delivery-verify-api
description: Backend API verification — endpoints, auth flow, error handling, content types
stage: delivery
auto_detect:
  deps: ["hono", "express", "fastify", "koa", "@nestjs/core"]
priority: 5
---

## API Verification Checklist

### Endpoint Content-Type

Every JSON endpoint must return `content-type: application/json`:
```
curl -sD- http://localhost:{port}/api/health | grep -i content-type
```
If it returns `text/plain` or `text/html` → fix the response.

### Authentication Flow (if auth endpoints exist)

1. Register: `curl -X POST -H 'Content-Type: application/json' -d '{"username":"test","password":"test123"}' http://localhost:{port}/api/auth/register`
2. Login: should return a token in the response body
3. Protected endpoint WITHOUT token: `curl http://localhost:{port}/api/protected` → must return 401
4. Protected endpoint WITH token: `curl -H 'Authorization: Bearer {token}' http://localhost:{port}/api/protected` → must return 200

### Error Response Format

Test invalid requests:
```
curl -X POST -H 'Content-Type: application/json' -d '{}' http://localhost:{port}/api/some-endpoint
```
- 400 errors must return JSON body with error message
- 404 errors must return JSON, not HTML
- 500 errors must not leak stack traces

### Database Initialization

If the app uses SQLite:
- `data/` directory must be auto-created if missing
- Tables must be created on first run (CREATE TABLE IF NOT EXISTS)
- App must not crash if DB file doesn't exist yet
