# Browser Runtime PATH Discovery

## Problem

WSL has a working browser at `/home/yangheng/.local/bin/chromium-browser`, but
`BrowserRuntime.findBrowserExecutable()` only checks explicit environment
overrides and a short list of absolute paths:

- `OPENCORVUS_BROWSER_EXECUTABLE`
- `BROWSER_EXECUTABLE`
- Windows Chrome and Edge defaults
- `/usr/bin/google-chrome`
- `/usr/bin/chromium`
- macOS Chrome default

This made `frontend_design` report `browser_missing` even though the executable
was available in `PATH`.

## Call Point Inventory

The single source remains `packages/opencorvus/src/browser/runtime/index.ts`.
Existing consumers already call `BrowserRuntime.findBrowserExecutable()`:

- `packages/opencorvus/src/web-clone/singlefile-capture.ts`
- `packages/opencorvus/src/browser/webpage/runtime-state.ts`
- `packages/opencorvus/src/browser/webpage/render.ts`
- `packages/opencorvus/src/browser/webpage/extract.ts`
- `packages/opencorvus/src/browser-preview/live.ts`
- `packages/opencorvus/src/browser-preview/evidence-runner.ts`
- `packages/opencorvus/src/frontend-design/capture-gate.ts`
- `packages/opencorvus/src/acceptance/checks/walkthrough/run.ts`
- `packages/opencorvus/src/runtime/visual-page.ts`
- `packages/opencorvus/src/mcp/browser/sessions.ts`

Related tests:

- `packages/opencorvus/test/browser/runtime.test.ts`
- `packages/opencorvus/test/mcp/browser-stdio.test.ts`
- `packages/opencorvus/test/mcp/browser-session-lifecycle.test.ts`
- `packages/opencorvus/test/browser/webpage/runtime-state.test.ts`

## Decision

Improve only the shared BrowserRuntime discovery path:

1. Preserve explicit override precedence.
2. Preserve existing absolute-path candidates.
3. Add deterministic `PATH` command discovery for standard browser executable
   names: Chrome, Chromium, Edge, and Chrome for Testing aliases.
4. Include PATH-derived candidates in the existing missing-browser diagnostic.

This is a deterministic candidate expansion inside the existing single source,
not a second launch path and not caller-specific fallback behavior.

## Verification

- Add unit coverage for PATH-discovered `chromium-browser`.
- Run `bun test packages/opencorvus/test/browser/runtime.test.ts`.
- Manually verify WSL smoke:
  `/home/yangheng/.local/bin/chromium-browser --headless=new --no-sandbox --disable-gpu --dump-dom ...`
