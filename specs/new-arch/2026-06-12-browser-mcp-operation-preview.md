# Browser MCP Operation Preview

Date: 2026-06-12

## Acronyms

- API: Application Programming Interface, the backend route or module contract consumed by callers.
- DB: Database, the persisted task artifact store backed by `engine_artifact`.
- DOM: Document Object Model, the page tree summarized from Playwright.
- HTTP: Hypertext Transfer Protocol, the transport used by preview routes and Browser MCP streamable mode.
- ID: Identifier, a stable database, task, target, session, or artifact key.
- MCP: Model Context Protocol, the tool protocol used by the built-in Browser MCP server and external MCP tools.
- PNG: Portable Network Graphics, the image format returned by preview screenshots.
- UI: User Interface, the overlay surface shown to the operator.
- URL: Uniform Resource Locator, the address saved in a browser preview target.

## Problem

The right preview panel now has the correct ownership model: it renders from a task-scoped backend browser preview target, persisted evidence, and backend Playwright live snapshot/input routes. The built-in Browser MCP server also already records a rich operation stream in Node memory through `recordToolCall`, `updateToolCall`, `getToolCalls`, and `getDiagnostics`.

Those two systems are still disconnected. Browser MCP operations are visible only to the MCP caller and the sidecar monitor. The overlay cannot show the actual navigation/click/type/screenshot process that the Node MCP sidecar performed, and agents cannot cite those operations as task-scoped preview evidence.

The tempting implementation is to directly pipe Node MCP activity into the overlay. That is not acceptable: it would create a second preview source beside `browser_preview_target` and `browser_preview_evidence`, and it would make the UI depend on a sidecar-local session rather than persisted task evidence.

## Decision

Render the Node Browser MCP operation process in the preview panel, but only after the backend persists it as a task-scoped browser preview operation trace.

The preview panel remains a renderer of backend task artifacts. Browser MCP remains a Playwright tool surface. A small backend bridge promotes Browser MCP operations into persisted preview operation artifacts only when the MCP call is associated with a real task preview target.

This gives the desired fancy behavior without letting the overlay, Node process, MCP monitor, or local signals become a parallel source of truth.

## Call Point Audit

| Surface                    | Current call point                                                                                                                                                                                      | Decision                                                                                                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preview target persistence | `packages/opencorvus/src/browser-preview/persist.ts` writes `browser_preview_target` and `browser_preview_evidence`.                                                                                    | Add `browser_preview_operation` helpers in this module or a sibling module so operations share the task artifact table and task update event.                                                               |
| Preview target route       | `packages/opencorvus/src/server/routes/browser-preview.ts` exposes task target, evidence, capture, live snapshot, and live input.                                                                       | Add task-scoped operation list and operation frame routes under the same route group.                                                                                                                       |
| Preview live session       | `packages/opencorvus/src/browser-preview/live.ts` owns task target live frames and user input.                                                                                                          | Keep as panel/operator live path; do not use it to impersonate Browser MCP sessions.                                                                                                                        |
| Preview evidence runner    | `packages/opencorvus/src/browser-preview/evidence-runner.ts` writes Playwright capture manifests.                                                                                                       | Keep capture evidence separate; operation traces can reference screenshot files but must not replace capture verification.                                                                                  |
| Overlay service            | `packages/overlay/src/services/browser-preview.ts` calls only `task/:taskID/browser-preview*` APIs.                                                                                                     | Extend this service with operation list and frame image clients; no direct MCP or sidecar URLs.                                                                                                             |
| Overlay panel              | `packages/overlay/src/components/BrowserPreviewPanel.tsx` renders live PNG, capture evidence, candidates, and controls.                                                                                 | Add an operation timeline/layer beside the live image. It reads backend operation artifacts and uses existing UI primitives.                                                                                |
| Overlay tests              | `packages/overlay/test/browser-preview-panel.test.ts`, `packages/overlay/test/browser/browser-preview-evidence.test.ts`, and service tests guard route usage/no iframe.                                 | Add assertions that operation rendering uses browser-preview task routes, not EventSource, fixed MCP port, monitor route, direct `fetch`, or iframe.                                                        |
| Browser MCP tool tracing   | `packages/opencorvus/src/mcp/browser/tools.ts` wraps `server.registerTool` with `traced`.                                                                                                               | Keep sidecar-local tracing as execution diagnostics. Do not make Phase 2 depend on host-injected in-memory hooks inside this child process.                                                                 |
| Browser MCP session memory | `packages/opencorvus/src/mcp/browser/sessions.ts` stores `toolCalls`, diagnostics, sessions, pages, profiles.                                                                                           | Keep memory as execution-local state only; persisted operation artifacts become the UI source.                                                                                                              |
| Browser MCP screenshots    | `packages/opencorvus/src/mcp/browser/tools.ts` returns screenshot base64 via `okImage`; `materializeMcpToolResult` writes attachments.                                                                  | For task-associated Browser MCP calls, persist screenshot bytes to browser-preview operation artifacts with file paths and hashes.                                                                          |
| Browser MCP monitor        | `packages/opencorvus/src/mcp/browser/monitor.ts` exposes a sidecar-local monitor and screenshot endpoint.                                                                                               | Leave as non-task diagnostics; preview panel must not consume monitor endpoints.                                                                                                                            |
| Browser MCP launch         | `packages/opencorvus/src/mcp/browser/node-launcher.ts` starts the Node MCP bundle.                                                                                                                      | Keep Node runtime path; no Bun Playwright launch.                                                                                                                                                           |
| MCP client execution       | `packages/opencorvus/src/mcp/index.ts` converts each MCP tool into an AI SDK tool and calls `client.callTool`; local MCPs run over stdio, so the host and Browser MCP server are separate processes.    | Treat this host-side client wrapper as the Phase 2 operation bridge. Persist start/completion around `client.callTool`; do not assume an in-memory hook can be injected into the Browser MCP child process. |
| MCP tool namespace         | `packages/opencorvus/src/mcp/index.ts` exposes tools as `sanitizedClientName + "_" + sanitizedToolName`; built-in Browser MCP server raw tools are names such as `navigate`, `click`, and `screenshot`. | Bridge only the configured built-in Browser MCP client identity plus raw MCP tool name. Do not rely only on `key.startsWith("browser_")`, because an external MCP named `browser` could collide.            |
| Browser MCP host wrapping  | `packages/opencorvus/src/session/loop.ts` wraps MCP tools, applies Browser MCP permissions for `browser_*`, materializes images, and writes tool parts.                                                 | Attach task preview context at this host layer and persist operation traces before/after the MCP tool call. Do not revive automatic URL target extraction from MCP output.                                  |
| MCP materialization        | `packages/opencorvus/src/mcp/materialize.ts` extracts browser observation metadata from structured content.                                                                                             | Reuse this shape as one input source for operation payloads, but operation persistence must not depend on message attachments as the source of truth.                                                       |
| Engine artifact kind union | `packages/opencorvus/src/engine/engine.sql.ts` lists `browser_preview_target` and `browser_preview_evidence`.                                                                                           | Add `browser_preview_operation` to the union; no DB migration is needed because kind is a text column.                                                                                                      |
| OpenAPI and SDK            | `packages/sdk/openapi.json`, `packages/sdk/js/src/gen/types.gen.ts` include browser-preview routes.                                                                                                     | Regenerate after route additions.                                                                                                                                                                           |
| Agent prompts              | `orchestrator-core.txt`, `visual-qa-core.txt`, `integrity-team-core.txt` now require explicit `browser_preview`.                                                                                        | Clarify that Browser MCP operations shown in preview are persisted operation traces, not automatic target discovery or visual pass/fail evidence.                                                           |

## Target Model

Add a third browser preview artifact kind:

```ts
type BrowserPreviewOperationArtifact = {
  id: string
  taskID: string
  targetID: string
  mcpSessionID: string
  toolCallID?: string
  tool: string
  status: "running" | "ok" | "error"
  args: Record<string, unknown>
  startedAt: number
  completedAt?: number
  elapsedMs?: number
  page?: {
    url?: string
    title?: string
    viewport?: { width?: number; height?: number }
  }
  pointer?: {
    x?: number
    y?: number
    selector?: string
  }
  screenshot?: {
    path: string
    sha: string
    mimeType: "image/png"
    width?: number
    height?: number
  }
  diagnostics?: {
    consoleErrors: number
    pageErrors: number
    failedRequests: number
    httpErrors: number
  }
  summary: string
}
```

The key ownership rule is `taskID + targetID`. If a Browser MCP tool call cannot prove both values, it remains ordinary MCP output and must not update the preview operation timeline.

`browser_preview_operation` is a process trace artifact. It records how an agent inspected or interacted with a target. It is not visual pass/fail evidence. Integrity and visual-qa may cite operation IDs to explain reproduction steps, but acceptance of visual correctness still comes from `browser_preview_evidence` capture artifacts or other runner-owned verification evidence.

## Backend Design

### Persistence

Create browser-preview operation persistence beside the current target/evidence helpers:

- `BROWSER_PREVIEW_OPERATION_KIND = "browser_preview_operation"`.
- `persistBrowserPreviewOperationStarted(input)` writes a `running` artifact row.
- `persistBrowserPreviewOperationCompleted(input)` updates the same row to `ok` or `error`.
- `findRecentBrowserPreviewOperations({ taskID, targetID, limit })` returns newest operations for the selected target.
- `findReadableBrowserPreviewOperationFrame({ taskID, targetID, operationID })` validates target ownership, screenshot path readability, and hash before serving the image.

This follows the existing `browser_preview_evidence` pattern: artifact payloads carry paths and hashes; binary bytes are served only after backend readability checks.

### Task Association

Add one explicit association path. Browser MCP operations become preview operations only when the active agent/tool call has a task preview context:

```ts
type BrowserMcpPreviewContext = {
  taskID: string
  targetID: string
}
```

The context is created from the persisted browser preview target selected by `browser_preview`. It is attached at the host-side MCP wrapper, where the wrapper has the current session, message, tool call, agent metadata, and task preview target.

The bridge must identify the built-in Browser MCP by configured MCP client identity, not by string prefix alone. The exposed agent tool key is a host namespace such as `browser_screenshot`, while the raw MCP tool name inside the server is `screenshot`. Operation payloads should store both values:

```ts
type BrowserMcpToolIdentity = {
  clientName: string
  exposedToolKey: string
  rawToolName: string
  builtinBrowserMcp: true
}
```

External MCP servers must not become operation sources merely because their configured name sanitizes to `browser`.

No URL parsing is allowed here. If the Browser MCP page URL differs from the saved target URL, the operation payload records the observed URL, but the operation still belongs to the selected target ID. Target discovery remains explicit through `browser_preview` or operator URL save.

### Browser MCP Instrumentation

Phase 2 persists operation traces in the host process around the MCP client call. The existing Browser MCP server runs as a local stdio child process, so the host cannot install a plain in-memory callback into `packages/opencorvus/src/mcp/browser/tools.ts`.

The host-side wrapper records:

- start event: tool name, summarized args, MCP session ID, start time
- completion event: status, elapsed time, and error text when the MCP call fails
- page observation metadata from `structuredContent` after `client.callTool` returns, including URL/title/viewport when available
- optional screenshot event: PNG metadata and persisted file reference when the returned MCP content contains image data
- diagnostics counts from returned Browser MCP structured content when available

The Browser MCP child process remains reusable and does not import `engine_artifact`. A future side channel could stream richer in-progress details, but that is not required for Phase 2 and must still terminate in backend task artifacts before the overlay can render it.

### Routes

Add these routes under `BrowserPreviewRoutes`:

- `GET /task/:taskID/browser-preview/operations?targetID=:targetID&limit=50`
  - returns recent persisted operations for the target.
- `GET /task/:taskID/browser-preview/operations/:operationID/frame.png?targetID=:targetID`
  - returns a persisted PNG frame for a screenshot-bearing operation.

No route accepts a URL. No route accepts an MCP monitor URL or MCP port. Every operation route requires a persisted `targetID`; frame reads must reject wrong-target operation IDs even when the task ID matches.

### Events

Emit `TaskUpdated` after operation start and after operation completion. Screenshot-bearing operation completion updates the same artifact and emits the same backend event. The overlay already refreshes browser preview state from task updates; if that is too coarse, add a backend route field `latestOperationID` to the target response. Do not add an overlay-local event bus as a second source.

## Overlay Design

Extend `BrowserPreviewPanel` with an operation rail below or beside the live frame:

- timeline rows: icon, tool name, short args, status, elapsed time
- active operation highlight: running row with spinner
- pointer overlay: for click/hover/scroll operations with x/y, draw a small marker over the current live screenshot using viewport-scaled CSS
- screenshot thumbnail: if an operation has a frame, load it from the operation frame route and show it in the timeline
- diagnostics chip: console/page/network error counts from the operation payload

The panel still prioritizes the live screenshot as the main visual. Operation replay is an explanatory layer, not a replacement for target live view or capture evidence.

Use existing primitives:

- `Button` for refresh/capture actions
- `Tabs` for viewport selection
- `@kobalte/core/select` for candidates
- existing icons through `Icon`

Do not add iframe, EventSource, direct MCP HTTP calls, fixed `8931` calls, monitor endpoints, or raw `fetch` from the component.

## Agent Behavior

Orchestrator, visual-qa, and integrity keep using explicit `browser_preview` to create/select the task preview target. Browser MCP calls may then render as operation traces if the session has task preview context.

Prompt wording should be:

- use `browser_preview` to establish the target
- use Browser MCP only for inspection and interaction when needed
- cite persisted browser preview operation IDs for reproduction/process details
- cite `browser_preview_evidence` capture IDs, not operation traces, for visual pass/fail conclusions
- do not expect ordinary command output or Browser MCP output text to create preview targets

## Phases

### Phase 1: Persist Operation Stream

- Add `browser_preview_operation` artifact kind and persistence helpers.
- Add focused tests for started/completed operation rows and readable frame validation.
- Add route tests for operation list/frame routes, including task/target mismatch rejection.
- Extend OpenAPI and SDK generation.

Exit criteria: a fake persisted operation appears through task browser-preview routes and frame bytes are served only from readable matching artifacts.

### Phase 2: Browser MCP Bridge

- Add host-side Browser MCP operation bridge helpers around MCP client tool execution.
- Bind only the built-in Browser MCP client identity plus raw tool names; do not treat an arbitrary external MCP named `browser` as the built-in Browser MCP.
- Persist operation start/completion records for built-in Browser MCP calls with explicit preview context, without reviving automatic target extraction.
- Persist screenshot metadata for raw `screenshot` and `observe` image-bearing results exposed through the built-in Browser MCP namespace.

Exit criteria: Browser MCP operation artifacts are written only with explicit `{ taskID, targetID }`, and non-task MCP calls do not touch preview artifacts.

### Phase 3: Overlay Timeline

- Extend overlay service with operation list/frame clients.
- Add the operation rail and screenshot/pointer overlays to `BrowserPreviewPanel`.
- Add i18n keys and CSS using the existing browser-preview surface.

Exit criteria: browser tests show the panel renders operations from backend task routes and never calls MCP monitor, direct MCP HTTP, iframe, EventSource, or local preview state.

### Phase 4: Agent Prompt and Evidence Citation

- Update orchestrator, visual-qa, and integrity prompts to cite operation traces when using Browser MCP.
- Add prompt/tool tests proving `browser_preview` remains the explicit target owner and Browser MCP operation traces are not target discovery or visual pass/fail evidence.

Exit criteria: agents can use MCP interactions for inspection while the Preview panel shows the same persisted operation artifacts.

## Tests

- Persistence: operation started/completed artifacts keep task ID, target ID, MCP session ID, tool, status, args, timing, diagnostics, and screenshot metadata.
- Persistence negative: operations without task ID or target ID are rejected before writing.
- Route: operation list requires task context and returns only operations for the requested target.
- Route: frame route rejects missing files, hash mismatch, wrong task, wrong target, and wrong artifact kind.
- MCP bridge: non-task Browser MCP calls do not create operation artifacts.
- MCP bridge: task-associated `browser_navigate`, `browser_click`, `browser_type`, `browser_screenshot`, and `browser_observe` create operation artifacts.
- MCP bridge negative: external MCP configured with the client name `browser` does not create `browser_preview_operation` artifacts.
- MCP bridge negative: Browser MCP output text containing a localhost URL does not create or select a preview target.
- Overlay service: operation list/frame clients call only `task/:taskID/browser-preview/operations*`.
- Overlay static: component has no iframe, no EventSource, no direct `fetch`, no monitor route, no `8931`, and no Browser MCP URL construction.
- Overlay browser: operation rail renders persisted operations, frame thumbnails load, pointer marker aligns with screenshot bounds, and text does not overlap at desktop/mobile widths.
- Prompt: orchestrator, visual-qa, and integrity prompts mention persisted operation traces and keep explicit `browser_preview` target ownership.
- Typecheck: backend, overlay, SDK generated types, and route OpenAPI are consistent.

## Non-Goals

- Do not make Browser MCP a second task evidence owner.
- Do not treat operation traces as visual pass/fail evidence.
- Do not let overlay subscribe directly to the Node process.
- Do not consume Browser MCP monitor routes in the preview panel.
- Do not infer preview targets from MCP output text.
- Do not replace capture evidence with operation replay.
- Do not add command gates or Playwright command detection.
- Do not launch Playwright through Bun on Windows.

## Open Implementation Notes

- The first implementation should persist operations in the host MCP client wrapper. A child-process hook or IPC side channel is optional later work, not a Phase 2 dependency.
- If operation screenshots are already materialized as attachments by `materializeMcpToolResult`, the operation artifact should still own its own readable path/hash metadata. Attachments are message artifacts, not the browser-preview evidence source.
- Running operations are persisted as rows at start so the preview can render a real running state. Completion updates the same backend artifact; the overlay still reads through task routes.

## Independent Review Ledger

Independent reviewer `019ebaad-b0a8-7a12-b602-114bdc3b3cf6` reviewed this plan on 2026-06-12. The review found no blocker in the high-level direction, but raised these required corrections:

| Finding                                                                        | Resolution in this revision                                                                                                                              |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host cannot inject an in-memory hook into the Browser MCP stdio child process. | Phase 2 now persists operation traces in the host-side MCP client wrapper around `client.callTool`; Browser MCP child tracing remains local diagnostics. |
| MCP client namespace and raw tool names were missing from the audit.           | Added `packages/opencorvus/src/mcp/index.ts` audit rows and the `BrowserMcpToolIdentity` contract.                                                       |
| Frame route lacked target ownership.                                           | Frame helper and route now require `targetID` and tests require wrong-target rejection.                                                                  |
| Operation evidence could be confused with capture evidence.                    | `browser_preview_operation` is now explicitly a process trace artifact; visual pass/fail still requires `browser_preview_evidence`.                      |
| Running timeline events were underspecified.                                   | `TaskUpdated` is now emitted on operation start and completion.                                                                                          |
| External MCP named `browser` could collide with prefix checks.                 | Tests and bridge design now require built-in Browser MCP identity, not prefix-only matching.                                                             |
