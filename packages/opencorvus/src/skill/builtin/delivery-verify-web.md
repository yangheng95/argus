---
name: delivery-verify-web
description: Full-stack web project verification — structural page integrity, asset loads, hydration, visual proof
stage: delivery
auto_detect:
  files: ["web/", "public/", "src/App.tsx", "src/App.vue", "src/App.svelte"]
  deps: ["react", "vue", "svelte", "next", "nuxt", "solid-js", "hono", "express"]
  task_signals:
    request_contains_url: true
    has_attachment_image: true
priority: 10
required_tools:
  - verify_page_integrity
  - screenshot
---

## Web delivery verification — contract, not checklist

This skill is ENFORCED: `submit_verdict(verdict="accepted")` is rejected unless
`tool_call_evidence[]` carries at least one `passed=true` record for **every**
tool listed in `required_tools`. Curl output does not substitute for puppeteer
— a JSON 404 body with content-type text/html is invisible to curl and has
historically passed "manual" checks while the real UI was broken.

### Required flow

1. `run_command` to build + start the delivered app (`bun run build`, then
   whatever script the project's package.json uses to launch the server). Wait
   until the log prints a listening address.

2. **`verify_page_integrity`** against the root URL (and any deep route the
   spec describes). The six layers are all gating — `passed` must be `true`
   for the call to count:
   - HTTP: status 2xx, `content-type: text/html`, body ≥ 200B
   - Asset: zero 4xx/5xx on any `<script src>` / `<link href>` / `<img src>`
   - DOM: `body` descendant count ≥ `min_dom_descendants` (default 20)
   - JS: zero `pageerror` + zero `console.error`
   - Pixel: screenshot pixel-variance ≥ 25 (rejects blank pages, JSON error
     bodies, pre-hydration stubs)
   - Expected: every `expect_selectors` resolves, every `expect_texts`
     substring appears in `document.body.textContent`
   Populate `expect_selectors` and `expect_texts` from the task's design specs
   (header brand, primary CTA, chart canvas, watchlist rows, etc.). Empty
   arrays waive layer 6 — don't waive for non-trivial UIs.

3. **`screenshot`** of each significant state (initial load, post-interaction,
   post-fix) if fixes were applied. Cite the returned SHA in the evidence.
   `pixel_variance < 25` marks the capture degenerate — that screenshot alone
   is NOT proof of rendering; investigate the server/build wiring.

4. API integrity (when the project exposes `/api/*`): `run_command` with
   `curl -sD-` or equivalent against every endpoint the spec lists; assert
   status 2xx and the response content-type matches the intent (JSON APIs
   must return `application/json`, never `text/html`).

### tool_call_evidence — what to cite in submit_verdict

For each required tool, one entry with:
- `tool`: exact tool name
- `target`: the URL / path that was checked
- `passed`: the boolean from the tool's report
- `detail`: reproducer-grade — `{ status, content_type, body_length, assets_failed: N, dom_descendants: N, console_errors: N, pixel_variance: N, missing_selectors: [...], missing_texts: [...] }`. Prose like "looks fine" is rejected.
- `attachment_sha`: the screenshot sha when the tool produced one

### Common real failures this skill is designed to catch

- Vite-dev `index.html` shipped to production (`<script src="/src/main.tsx">`)
  while the server only serves `dist/`. Layer 2 catches the 404 on the
  unresolvable script; layer 5 catches the resulting blank render.
- Hono `serveStatic({ root: './dist' })` launched before `vite build` ran —
  the SPA-fallback `notFound()` handler returns `{"error":"Not found"}` JSON.
  Layer 1 catches the `content-type: application/json`.
- React hydration mismatch / context-provider missing — layer 4 catches the
  console error; layer 3 catches the empty root div.
- Server started without PORT binding or on wrong port — the goto itself
  fails; the tool returns `url` unreachable.

Do NOT call `submit_verdict(accepted)` on curl output alone. The verdict
enforcement will reject it.

### P1-A runtime-evidence pre-gate

Before your session even opens, `DeliveryService` runs an independent
`computeRuntimeEvidence` against the merged worktree (puppeteer +
`findRenderedIndex`). If the build artifact is missing, the root mount
point is an empty `<div id="root"></div>` shell, or the rendered DOM has
< ~120 chars of text or < ~60 nodes, the service synthesizes a
`rejected` verdict with `category="runtime"` and **never invokes this
agent**. Therefore:

- If you ARE running, runtime-evidence already saw a non-empty DOM. A
  zero-violation runtime report is a precondition, not a certification
  of correctness — keep performing layers 1-6 above.
- If a prior round got synth-rejected with `runtime:*` violations, your
  job this round is to MAKE the app actually render (fix build / main
  mount / data fetch), not to write prose explaining why an empty page
  is acceptable.
