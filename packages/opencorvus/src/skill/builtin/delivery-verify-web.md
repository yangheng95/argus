---
name: delivery-verify-web
description: Full-stack web project verification — MIME types, SPA routing, SSE, CORS
stage: delivery
auto_detect:
  files: ["web/", "public/", "src/App.tsx", "src/App.vue", "src/App.svelte"]
  deps: ["react", "vue", "svelte", "next", "nuxt", "solid-js", "hono", "express"]
priority: 10
---

## Web Full-Stack Verification Checklist

When verifying a full-stack web project, check ALL of the following BEFORE marking as accepted.

### Static File MIME Types (CRITICAL)

This is the #1 cause of white-screen bugs. Run:
```
curl -sD- http://localhost:{port}/assets/{any-js-file} | head -5
```

- `.js` files MUST return `content-type: application/javascript` or `text/javascript`
- `.css` files MUST return `content-type: text/css`
- If you see `content-type: application/octet-stream` → THE APP IS BROKEN

**Common fix for Hono:**
Replace manual `new Response(readFile(path))` with:
```typescript
import { serveStatic } from 'hono/bun'
app.use('/assets/*', serveStatic({ root: './web/dist' }))
```

**Common fix for Express:**
```typescript
app.use('/assets', express.static('web/dist/assets'))
```

### SPA Routing

Test a non-root path:
```
curl -s http://localhost:{port}/some/deep/route | head -3
```
- Should return index.html content (not 404)
- API routes (`/api/*`) should NOT return index.html

### Frontend Bundle Integrity

```
ls web/dist/assets/
```
- At least one `.js` file and one `.css` file must exist
- `web/dist/index.html` must reference these files with correct paths
- Compare `<script src="...">` paths in HTML against actual files in `web/dist/assets/`

### API Content-Type

```
curl -sD- http://localhost:{port}/api/health | grep -i content-type
```
- JSON endpoints MUST return `content-type: application/json`
- Never `text/html` for API endpoints

### SSE / WebSocket (if applicable)

If the app uses Server-Sent Events:
```
timeout 3 curl -N http://localhost:{port}/api/sse 2>&1 | head -5
```
- Should see `content-type: text/event-stream`
- Should see `data:` lines within 3 seconds

### Server Startup Log

The server MUST print a startup message (e.g., "Listening on http://localhost:3000").
If `bun run index.ts` produces no output, add:
```typescript
console.log(`Server running on http://localhost:${port}`)
```
