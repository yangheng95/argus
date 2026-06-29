# Browser MCP Web Research Proxy

## Recall

- User request: MCP still fails after the packaged `browser-mcp-node/package.json` fix; identify the recent change that caused it and fix the real issue.
- Acceptance criteria:
  - The packaged sidecar manifest fix remains intact.
  - Browser MCP no longer reads `BROWSER_PROXY`, `HTTPS_PROXY`, `HTTP_PROXY`, or `ALL_PROXY` from process env for `session_create` launch.
  - Browser MCP does use the existing single config source `network.proxy.webResearch` when `session_create.proxy` is omitted.
  - The Node-target browser MCP bundle does not import `Config` or other Bun-only server modules.
  - An explicit `session_create.proxy` still wins over config.
  - Tests prove the MCP proxy bridge instead of relying on runtime fallback.
- Hard constraints:
  - No env fallback restoration.
  - No second proxy source.
  - No restart, kill, refresh, or other interference with the user's running OpenCorvus / overlay process.
  - Do not revert or overwrite unrelated dirty worktree changes.
- Disk records read before implementation:
  - `specs/records/2026-06/2026-06-13-browser-runtime-path-discovery.md`
  - `specs/records/2026-06/2026-06-18-frontend-design-authenticated-browser-proxy.md`
  - `specs/records/2026-06/2026-06-29-spec-consolidation.md` addenda 59, 65, and 66
  - `specs/records/2026-06/2026-06-29-browser-mcp-node-package-manifest.md`
- Whole-repository grep evidence:
  - `BrowserRuntime.resolveBrowserProxyConfig()` is the shared parser that strips credentials from launch args and exposes Playwright context credentials.
  - `resolveNetworkProxy(await Config.get(), "webResearch")` is already used by frontend-design web capture and web fetch traffic.
  - `packages/opencorvus/src/mcp/browser/tools.ts` exposes `session_create.proxy`, but the handler passes raw args directly to `createSession`.
  - `packages/opencorvus/src/mcp/browser/sessions.ts` now intentionally uses `BrowserRuntime.defaultLaunchArgs({ env: {} })`, so process proxy env is ignored.
  - `packages/opencorvus/src/mcp/browser/tools.ts` is bundled for Node by `BrowserMCPNodeLauncher.buildSourceBundle()`, so it cannot import `Config` directly.
  - `opencorvus mcp browser` starts as a separate process with project cwd but no existing `Instance` context.
  - `packages/opencorvus/src/mcp/browser/tools.ts` imported `@/session/model-image-input`, which imports `sharp` through `requireRuntimePackage()` at module load time and crashes source-mode browser MCP under system Node.
  - Current tests cover env-ignore behavior but do not cover the config-to-MCP proxy bridge.
- Independent agent feedback: none in this turn; the existing addendum record names Raman/Lovelace findings that introduced env-independent MCP browser launch.

## Root Cause

The package manifest failure was fixed in the sidecar artifact. The remaining MCP browser risk comes from the later proxy hardening: MCP browser launch intentionally stopped inheriting process proxy env and only accepts an explicit session proxy. That is correct for removing env fallback, but `session_create` never translated the existing `network.proxy.webResearch` config into that explicit proxy input.

As a result, a configured web research proxy reaches frontend-design and web fetch code paths, but not browser MCP sessions. Browser MCP sessions default to no proxy unless the LLM manually supplies `session_create.proxy`, which it normally cannot derive from config.

There is a second startup-level regression in the same MCP surface: browser MCP tools imported the session image-preparation module only to reuse screenshot pixel-summary helpers. That module has a top-level `sharp` runtime-package require, so the source-mode Node MCP bundle exits before it can answer `listTools`.

## Plan

1. Move the existing webResearch browser proxy resolver into a shared browser module.
2. Keep frontend-design using the shared resolver.
3. Resolve `network.proxy.webResearch` in the outer Browser MCP launcher under an `Instance.provide({ directory: process.cwd() })` context and pass it into the Node-target bundle through a structured internal env value.
4. Add an MCP browser session proxy resolver that chooses explicit `session_create.proxy` first, then the internal webResearch env value.
5. Use that resolver in the `session_create` tool handler.
6. Move screenshot pixel-summary logic into a pure module and keep `model-image-input.ts` as a re-exporting native-image consumer.
7. Add targeted tests for config proxy injection, explicit proxy precedence, and browser MCP stdio startup.

## Startup Latency Addendum

### Recall

- User request: after `bun run build:overlay`, the overlay MCP panel still shows browser `Connecting`; verify whether MCP can really connect and whether today's MCP changes caused it.
- Acceptance criteria:
  - Distinguish backend MCP connectivity from overlay UI status.
  - Preserve the packaged `browser-mcp-node/package.json` fix.
  - Explain the visible `Connecting` state with process/log evidence, not guesswork.
  - If a code fix is made, remove the startup-path cause rather than hiding `Connecting` in UI.
  - Keep `network.proxy.webResearch` as the single config source for browser MCP proxy.
- Hard constraints:
  - No fallback proxy source, no process proxy env fallback, and no UI gate that pretends MCP is connected.
  - Do not restart, kill, refresh, or otherwise interfere with the user's running overlay process.
  - Do not revert or overwrite unrelated dirty worktree changes.
- Disk records read before implementation:
  - `specs/records/2026-06/2026-06-29-browser-mcp-node-package-manifest.md`
  - this record's original Recall and Plan above
- Whole-repository grep evidence:
  - `MCP.status()` starts configured MCP connections asynchronously and returns `connecting` while the connection promise is in flight.
  - `SkillMarketPanel.tsx` polls `loadMcpStatus()` every 1000 ms while the MCP panel is active and commits the returned map through `setMcp`.
  - `BrowserMCPNodeLauncher.childEnvironment()` currently calls `Instance.provide(... resolveWebResearchBrowserProxy ...)` inside the `opencorvus.exe mcp browser` child before spawning `browser-mcp-node/node.exe`.
  - The current overlay log shows `/mcp` first requested at `2026-06-29T16:02:38.547Z`, browser MCP found at `16:02:38.669Z`, and `create() successfully created client` at `16:02:45.905Z`.
  - The process chain shows `opencorvus.exe mcp browser` created at local `2026-06-30 00:02:38` and `browser-mcp-node/node.exe` created at `00:02:45`.
- Independent agent feedback: none; local logs, process metadata, and source evidence are sufficient for this narrow startup-path fix.

### Root Cause

The screenshot is not the original missing-package failure. In the rebuilt sidecar, browser MCP does connect, but the UI exposes the backend's asynchronous `connecting` status for about 7.2 seconds on cold startup.

Today's browser MCP proxy bridge put project config resolution inside the `opencorvus.exe mcp browser` child process. That child starts from a cold packaged executable and reconstructs project context before it can spawn the packaged Node MCP bundle. The main overlay server already has the project `Instance` context when it creates the local MCP transport, so resolving `network.proxy.webResearch` there is the single-source path and avoids a second cold project-context startup.

### Plan

1. Move browser MCP proxy env construction from `BrowserMCPNodeLauncher.childEnvironment()` into `MCP.create()` when the local MCP key is the built-in browser server.
2. Keep the encoded env value as an internal transport value into the Node bundle; do not re-enable process proxy env fallback.
3. Update the proxy bridge test to assert the main MCP transport environment owns this computation and the child launcher no longer imports `Instance` or `Config`.
4. Run targeted MCP/browser tests and existing package-manifest tests.
