# Built-in Browser MCP and Unified Browser Runtime

- Date: 2026-05-29
- Status: Draft, must be implemented before treating browser MCP as a finished built-in capability.
- Related work: built-in `mcp.browser` registration, `opencorvus mcp browser`, existing acceptance and webpage capture paths.
- Decision source: user requested browser MCP to become built-in, then requested independent agent discussion before implementation.

---

## Section 0. Problem

The surface request is simple: make `browser-mcp.zip` an OpenCorvus built-in Model Context Protocol (MCP) server instead of a manual zip-based integration.

The real engineering problem is broader:

1. OpenCorvus already has browser usage in acceptance checks, design capture, webpage rendering, and URL extraction.
2. The imported browser MCP code starts its own Playwright Chromium runtime directly.
3. That creates two browser runtime sources: existing `puppeteer-core` plus Chrome discovery, and new Playwright browser cache semantics.
4. A built-in capability must work on a clean machine, in source mode, and in packaged binary mode.
5. Browser evidence must become OpenCorvus evidence, not just base64 text inside an MCP result.

Therefore, the correct deliverable is not "unzip the MCP into the repo". The correct deliverable is:

- built-in browser MCP as the protocol boundary;
- one Browser Runtime as the execution boundary;
- OpenCorvus workflow as the evidence and decision boundary.

---

## Section 1. Architectural Decision

Create a single browser execution layer, tentatively named `BrowserRuntime`, and make every OpenCorvus browser consumer depend on it.

### Layers

1. Config and MCP client layer
   - Materializes built-in `mcp.browser` by default.
   - Allows only explicit disable through `{ "enabled": false }`.
   - Shows `connected`, `disabled`, `failed`, and diagnostic status.
   - Proxies external MCP tools as normal OpenCorvus tools, such as `browser_screenshot`.

2. Browser MCP server layer
   - Owns MCP transports: stdio and optional HTTP for debugging.
   - Owns tool names, input schemas, output schemas, and MCP result conversion.
   - Calls `BrowserRuntime`.
   - Must not own browser executable discovery, browser launch policy, or OpenCorvus artifact storage.

3. Browser Runtime layer
   - Owns browser executable discovery and launch.
   - Owns browser, context, profile, page, session, viewport, storage, and cleanup lifecycles.
   - Owns screenshot, page observation, console, network, accessibility snapshot, init script injection, and trace collection primitives.
   - Provides diagnostics and deterministic error types.

4. OpenCorvus workflow layer
   - Decides when to use browser observation.
   - Persists screenshot and trace evidence through attachment storage.
   - Presents browser evidence in overlay and acceptance results.
   - Keeps final visual judgment in acceptance or integrity, not inside browser MCP.

### Runtime engine choice

The short-term single source must be the existing `puppeteer-core` plus Chrome discovery path, promoted into a real runtime module. The repository already uses this path in acceptance, webpage capture, and design capture. Keeping Playwright as a second browser stack creates install, packaging, and behavior drift.

Long-term Playwright is allowed only if acceptance, webpage capture, design capture, and browser MCP move together to the same runtime. Parallel browser stacks are forbidden.

---

## Section 2. Current Implementation Risks

### Risk 1: browser tools can list but session creation can fail

Current imported browser MCP code calls Playwright directly:

- `packages/opencorvus/src/mcp/browser/sessions.ts`
- symbol: `acquireBrowser`
- behavior: `chromium.launch(...)`

On machines without a Playwright browser cache, `listTools` can succeed while `session_create` fails with a missing Chromium executable.

This is not an acceptable built-in feature state. A built-in tool must either work or report a recoverable OpenCorvus diagnostic.

### Risk 2: packaged binary resource paths are unstable

The imported runtime injects scripts by filesystem path:

- `packages/opencorvus/src/mcp/browser/sessions.ts`
- script: `virtual_cursor.js`
- `packages/opencorvus/src/mcp/browser/perf.ts`
- script: `perf_init.js`

Source mode can find those files. A single packaged binary may not. These scripts must become bundled content injected through runtime APIs, not files loaded by relative path.

### Risk 3: MCP config semantics are incomplete

The config schema allows an MCP entry shaped only as `{ enabled: boolean }`. This is useful as a disable marker, but `{ enabled: true }` is not a valid full local MCP configuration.

Required semantics:

- absent `mcp.browser`: materialize built-in browser MCP;
- `mcp.browser = { enabled: false }`: disable built-in browser MCP;
- `mcp.browser = { enabled: true }`: either rejected as invalid or materialized into the full built-in local config;
- `opencorvus mcp list` and status APIs must show disabled browser explicitly.

### Risk 4: screenshot evidence is not first-class OpenCorvus evidence

Browser MCP screenshots currently return image content and base64 structured content. OpenCorvus already has attachment storage and MCP materialization support. Browser observations must become attachments and acceptance evidence, not long-lived inline base64 payloads.

### Risk 5: high-risk browser actions bypass OpenCorvus permission semantics

Browser actions such as external navigation, JavaScript evaluation, file upload, storage export, profile persistence, and tracing can expose or mutate sensitive data. They must integrate with OpenCorvus permission policy.

---

## Section 3. Non-Goals

The browser MCP is not a test runner.

It must not:

- start development servers;
- run build, lint, unit tests, or end-to-end suites;
- embed full Playwright or Puppeteer APIs as MCP tools;
- implement visual diff or structural similarity scoring;
- write OpenCorvus database rows directly;
- write attachments directly from the MCP server;
- become the overlay user interface.

The MCP server provides observation and interaction tools. OpenCorvus workflow decides what those observations mean.

---

## Section 4. Browser Runtime Contract

Create a runtime module under a stable location such as:

```text
packages/opencorvus/src/browser/runtime/
```

Required responsibilities:

1. Resolve browser executable
   - explicit configured executable wins;
   - managed OpenCorvus browser cache is preferred when available;
   - system Chrome, Edge, and Chromium discovery is diagnostic-assisted, not duplicated at every call site;
   - failure produces an actionable error.

2. Check and install browser
   - `checkBrowser` validates executable availability and launchability;
   - optional `installManagedBrowser` downloads or prepares an OpenCorvus-managed browser;
   - failure text explains the recovery command.

3. Launch browser
   - one launch argument source;
   - source mode and packaged mode share the same behavior;
   - supports headless and visible browser modes;
   - supports proxy and hosts mapping through runtime options.

4. Manage sessions
   - browser, context, profile, page, and session lifecycle;
   - idle cleanup;
   - explicit profile preservation with expiration;
   - storage state import and export.

5. Observe page state
   - URL, title, viewport;
   - screenshot bytes and dimensions;
   - console errors;
   - page errors;
   - failed requests;
   - accessibility snapshot or interactive element summary;
   - optional performance summary.

6. Inject scripts
   - virtual cursor script;
   - performance collection script;
   - injected as bundled content, not filesystem paths.

7. Diagnostics
   - missing executable;
   - launch failure;
   - page crash;
   - navigation timeout;
   - certificate failure;
   - proxy failure;
   - resource cleanup issues.

---

## Section 5. Browser MCP Tool Contract

Keep the existing low-level tools for compatibility:

- `session_create`
- `session_destroy`
- `tabs`
- `navigate`
- `get_url`
- `reload`
- `go_back`
- `go_forward`
- `screenshot`
- `click`
- `double_click`
- `hover`
- `type`
- `press_key`
- `select_option`
- `check`
- `uncheck`
- `upload_file`
- `get_text`
- `get_attribute`
- `get_value`
- `is_visible`
- `count`
- `wait_for_selector`
- `wait_for_url`
- `wait_for_load`
- `scroll`
- `evaluate`
- `get_perf`

Add higher-level observation tools before adding more Playwright-like wrappers.

### Priority 0 tools

1. `observe`
   - Input: `sessionId`, `includeScreenshot`, `includeAccessibility`, `includeDiagnostics`.
   - Output: URL, title, viewport, screenshot metadata, interactive element summary, console and network summary.
   - Purpose: reduce repeated `screenshot -> get_text -> count -> evaluate` loops.

2. `diagnostics_get`
   - Output: console errors, page errors, failed requests, status code summary, unhandled rejections, performance summary.

3. `viewport_set`
   - Supports named device presets and explicit dimensions.
   - Presets must be shared with acceptance checks.

4. `storage_state_export` and `storage_state_import`
   - Explicit login state management.
   - Must include expiration or user-controlled persistence.

### Later tools

1. `trace_start` and `trace_stop`
   - Produces trace or video artifacts.
   - Default off.
   - Permission required.

2. `network_get`
   - Filter by request type, status, host, failed-only, and time window.

3. `visual_probe`
   - Objective checks only: blank page, low pixel variance, overflow indicators, visible interactive count.
   - Does not make final aesthetic judgments.

---

## Section 6. OpenCorvus Integration

### Attachment storage

MCP server returns standard MCP image or resource content. OpenCorvus materializes results at the MCP client boundary.

Implementation target:

- reuse `packages/opencorvus/src/mcp/materialize.ts`;
- write browser screenshots through `AttachmentStore`;
- store attachment references in session parts;
- avoid long-lived inline base64 in persisted conversation state.

Suggested evidence intents:

- `browser_observation`
- `runtime_capture`
- `rendered_output`

Do not mix runtime captures with user-provided visual references.

### Overlay

Overlay should show browser MCP evidence inside existing tool call or acceptance evidence surfaces:

- screenshot thumbnail;
- URL;
- viewport;
- console and network status;
- failed request count;
- attachment link.

The existing browser monitor page may remain a debug utility, but it is not the product overlay.

### Acceptance

Acceptance visual checks should use `BrowserRuntime`, not their own browser launcher.

Acceptance evidence should include:

- screenshot attachment;
- URL;
- viewport;
- console error count;
- failed request count;
- diagnostic summary;
- browser executable diagnostics when capture fails.

Browser MCP supplies evidence. Acceptance and integrity decide pass or fail.

### Orchestrator and build prompts

Prompt changes should teach workflow expectations, not add host gates.

Required guidance:

- For frontend, web, visual, or browser-visible work, obtain real browser evidence before claiming pass.
- Prefer `browser_observe` for broad inspection.
- Use low-level DOM tools only when precise assertions are needed.
- Do not use browser MCP as build, lint, or test runner.

External coding executor prompts need explicit names only if browser MCP is exposed through that executor surface. Avoid ambiguity with external tools that already provide browser or screenshot capabilities.

### Permission policy

Permission categories:

- Browser MCP permissions default to `allow`.
- Explicit project, agent, or session permission config can still set any browser MCP permission to `ask` or `deny`.
- `browser.navigate.localhost`, `browser.navigate.external`, `browser.evaluate`, `browser.upload_file`, `browser.profile.persist`, `browser.profile.reuse`, `browser.trace`, `browser.storage.export`, `browser.storage.import`, `browser.download`, and `browser.click.force` are covered by the default-allow baseline.

---

## Section 7. Configuration Semantics

Built-in config materialization:

```jsonc
{
  "mcp": {
    "browser": {
      "type": "local",
      "command": ["opencorvus", "mcp", "browser"],
      "timeout": 30000,
    },
  },
}
```

Source mode may use the current Bun executable and source `stdio.ts`, but packaged mode must use:

```text
opencorvus mcp browser
```

Disable form:

```jsonc
{
  "mcp": {
    "browser": {
      "enabled": false,
    },
  },
}
```

Rules:

- `{ enabled: false }` is a disable marker.
- `{ enabled: true }` must not create an invalid half-config.
- `opencorvus mcp list` must display disabled built-in browser MCP.
- status APIs must return disabled status for the disable marker.

---

## Section 8. Migration Plan

### Phase 1: fix built-in MCP correctness

1. Remove root zip as a source of truth.
2. Keep `opencorvus mcp browser` as the built-in MCP entry.
3. Fix `mcp.browser` config materialization and disable semantics.
4. Make disabled browser visible in status and list output.
5. Add `listTools` and `session_create` smoke coverage.
6. Inline virtual cursor and performance init scripts.

### Phase 2: create Browser Runtime

1. Move browser discovery out of acceptance-specific modules.
2. Introduce `BrowserRuntime` browser check, launch, diagnostics, and session APIs.
3. Rewire acceptance checks to use `BrowserRuntime`.
4. Rewire webpage visual rendering and URL extraction to use `BrowserRuntime`.
5. Rewire browser MCP tools to call `BrowserRuntime`.
6. Remove direct `playwright.chromium.launch()` from browser MCP.

### Phase 3: evidence integration

1. Materialize browser MCP image results into attachments.
2. Add browser observation metadata to tool call results.
3. Show browser evidence in overlay.
4. Add acceptance manifest browser evidence fields.

### Phase 4: product tools and permissions

1. Add `observe`.
2. Add `diagnostics_get`.
3. Add shared viewport presets and `viewport_set`.
4. Add storage state import and export.
5. Add permission checks for high-risk browser operations.
6. Add trace and network tools only after Priority 0 and Priority 1 paths are stable.

---

## Section 9. Call Point Inventory

These are the known browser-related call points that must be unified or reviewed.

### Browser MCP

- `packages/opencorvus/src/mcp/browser/index.ts`
- `packages/opencorvus/src/mcp/browser/tools.ts`
- `packages/opencorvus/src/mcp/browser/sessions.ts`
- `packages/opencorvus/src/mcp/browser/perf.ts`
- `packages/opencorvus/src/mcp/browser/monitor.ts`
- `packages/opencorvus/src/cli/cmd/mcp.ts`
- `packages/opencorvus/src/config/config.ts`
- `packages/opencorvus/src/mcp/index.ts`

### Existing browser execution users

- `packages/opencorvus/src/runtime/visual-page.ts`
- `packages/opencorvus/src/acceptance/checks/walkthrough/run.ts`
- `packages/opencorvus/src/frontend-design/capture-gate.ts`
- `packages/opencorvus/src/browser/webpage/render.ts`
- `packages/opencorvus/src/browser/webpage/extract.ts`

### Evidence and rendering users

- `packages/opencorvus/src/mcp/materialize.ts`
- `packages/opencorvus/src/storage/attachment-store.ts`
- `packages/opencorvus/src/build/agent.ts`
- `packages/opencorvus/src/orchestrator/tools.ts`
- `packages/opencorvus/src/prompt/core/build-core.txt`
- `packages/opencorvus/src/prompt/core/orchestrator-core.txt`
- `packages/overlay/src`

---

## Section 10. Tests

Required tests before browser MCP is considered complete:

1. Config tests
   - default `mcp.browser` materialization;
   - `{ enabled: false }` disables browser;
   - `{ enabled: true }` does not create invalid config;
   - disabled browser appears in status and list logic.

2. MCP server tests
   - source-mode command shape;
   - packaged command shape;
   - `opencorvus mcp browser` dispatches to browser MCP;
   - stdio `listTools` includes `session_create`, `screenshot`, and `observe`;
   - browser missing diagnostics are explicit.

3. Runtime tests
   - browser executable resolution;
   - explicit executable wins;
   - missing executable failure text;
   - launch and cleanup;
   - virtual cursor injection in source and packaged mode;
   - performance script injection in source and packaged mode.

4. Functional smoke tests
   - `session_create`;
   - `navigate` to a local HTML fixture;
   - `observe`;
   - `screenshot`;
   - `session_destroy`.

5. Integration tests
   - acceptance visual capture uses `BrowserRuntime`;
   - webpage rendering uses `BrowserRuntime`;
   - MCP image result materializes to attachment;
   - overlay can render browser evidence metadata.

6. Permission tests
   - external navigation asks or follows policy;
   - evaluate asks;
   - upload file uses file permission;
   - profile persistence asks;
   - trace asks.

7. Packaged binary smoke
   - compiled binary starts `opencorvus mcp browser`;
   - stdio `listTools` works;
   - `session_create -> screenshot -> destroy` works;
   - injected scripts work without filesystem source paths.

---

## Section 11. Acceptance Criteria

The migration is complete only when all of these are true:

1. No runtime path depends on `browser-mcp.zip`.
2. Browser MCP is built into OpenCorvus and enabled by default.
3. Browser MCP can be disabled through a documented config marker.
4. Browser MCP does not directly own browser executable discovery.
5. Browser MCP does not directly launch Playwright Chromium as a separate source.
6. Acceptance, webpage capture, design capture, and browser MCP use the same Browser Runtime.
7. Source mode and packaged mode use the same runtime behavior.
8. Missing browser executable produces actionable diagnostics.
9. Browser screenshots and observations become attachment-backed evidence.
10. Overlay can show browser evidence without relying on the debug monitor page.
11. High-risk browser operations obey OpenCorvus permission policy.
12. Tests cover config, runtime, MCP protocol, functional browser smoke, artifact materialization, permissions, and packaged binary behavior.

---

## Section 12. Immediate Follow-Up on Current Work in Progress

The current work in progress successfully moves the zip contents into source and wires default `mcp.browser`, but it is not yet the final design described here.

Before continuing feature work, fix these current gaps:

1. Remove any remaining zip as source of truth.
2. Fix `enabled: true` and disabled list/status behavior.
3. Inline `virtual_cursor.js` and `perf_init.js`.
4. Add a source-mode stdio functional smoke test that calls `session_create`.
5. Start extracting Browser Runtime from existing `puppeteer-core` browser discovery users.
6. Remove direct Playwright launch from the MCP implementation once Browser Runtime exists.
