# Browser Runtime PATH Discovery

## Problem

WSL has a working browser at `/home/yangheng/.local/bin/google-chrome`, but
`BrowserRuntime.findBrowserExecutable()` previously checked only explicit
environment overrides and a short list of absolute paths:

- `OPENCORVUS_BROWSER_EXECUTABLE`
- `BROWSER_EXECUTABLE`
- Windows Chrome and Edge defaults
- `/usr/bin/google-chrome`
- `/usr/bin/chromium`
- macOS Chrome default

This made `frontend_design` report `browser_missing` even though the executable
was available in an interactive shell. A second retry showed that the packaged
server and Browser MCP node sidecar can run with a non-login WSL environment
whose `PATH` omits `/home/yangheng/.local/bin`; shell availability alone is not
the same as runtime process availability.

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
3. Add deterministic Linux user-bin discovery for `$HOME/.local/bin` because
   this is where user-scoped browser provisioning landed in WSL.
4. Add deterministic `PATH` command discovery for standard browser executable
   names: Chrome, Chromium, Edge, and Chrome for Testing aliases.
5. Include derived candidates in the existing missing-browser diagnostic.

This is a deterministic candidate expansion inside the existing single source,
not a second launch path and not caller-specific fallback behavior.

## Verification

- Add unit coverage for PATH-discovered `chromium-browser`.
- Add unit coverage for Linux `$HOME/.local/bin/google-chrome` when `PATH`
  omits that user-bin directory.
- Run `bun test packages/opencorvus/test/browser/runtime.test.ts`.
- Manually verify WSL smoke:
  `/home/yangheng/.local/bin/google-chrome --headless=new --no-sandbox --disable-gpu --dump-dom ...`
