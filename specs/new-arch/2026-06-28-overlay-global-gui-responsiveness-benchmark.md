# Overlay Global GUI Responsiveness Benchmark

Date: 2026-06-28
Status: active investigation

## Acronyms

- GUI: Graphical User Interface, the visible overlay surface.
- DOM: Document Object Model, the rendered browser tree.
- RAF: RequestAnimationFrame, the browser frame callback used to sample frame gaps.
- SSE: Server-Sent Events, the selected-task stream used by the overlay.
- MCP: Model Context Protocol, the external tool/resource integration surface.

## Goal

The stream-jank repair proves one hot path, not the whole overlay. This pass
tracks global overlay responsiveness across the major GUI surfaces without
creating another worktree, restarting a user-running overlay, adding fallback
paths, or hiding broken functionality behind throttles.

## Acceptance

- Critical browser paths collect RAF drift or RAF gap evidence, long-task
  evidence where supported, bounded DOM materialization, request pressure, and
  screenshot artifacts.
- Key GUI paths stay under max drift 120 ms where the benchmark is dedicated to
  streaming responsiveness. Existing older surface-specific thresholds are
  recorded until their benchmarks are normalized.
- Browser Preview live input preserves click, wheel, and key order while keeping
  one in-flight task/target/viewport request owner.
- Workflow panels no longer render duplicated streamed body text. Conversation
  remains the streamed text owner.
- Hidden or inactive panels must not perform avoidable large DOM materialization
  or hidden search/network work.
- Any repaired behavior has focused unit/static tests plus real Node browser
  verification when it affects visible UI.
- Browser screenshots are reviewed after benchmark passes.

## Recalled Sources

| Source | Constraint |
| --- | --- |
| `2026-06-28-overlay-stream-jank-benchmark.md` | Streamed text belongs to the conversation, not duplicated workflow body rendering. |
| `2026-05-15-overlay-streaming-text-main-thread-plan.md` | Streaming text must avoid full markdown parsing and workflow text projection on every delta. |
| `2026-05-15-overlay-scroll-single-source-plan.md` | Scroll follow is driven by visible data version, not DOM mutation observation. |
| `2026-06-19-system-performance-high-confidence-pass.md` | Performance repairs require focused evidence and no user-running overlay restart. |
| `2026-06-22-browser-preview-live-input-batch-owner.md` | Browser Preview live input uses strict `inputs[]`, one in-flight owner, and no hidden evidence capture. |
| `2026-06-22-screenshot-browser-open-jank.md` | Screenshot browser opening must be virtualized, bounded, and frame-scheduled. |
| `2026-06-23-overlay-conversation-render-backpressure.md` | Agent rail uses server-hydrated records and parent IDs, not live card-tree scans. |
| `2026-06-23-agent-skill-mount-matrix.md` | `/skill/mounts` is the single skill matrix projection and browser fixtures must model it explicitly. |

## Coverage Matrix

| Surface | Current evidence | Status |
| --- | --- | --- |
| Conversation streaming | `conversation-stream-jank.test.ts` runs 120 history messages and 900 deltas with interval drift, long tasks, mounted card count, and screenshot. Latest observed after stream fix: drift 46.9 ms, 1 long task at 56.0 ms, 17 mounted cards. | Covered for the reproduced stream path. |
| Workflow / inspector | `workflow-generating-status-browser.test.ts` proves live workflow status without streamed body text. Stream benchmark asserts `workflowMessages=0`. | Functional coverage only; still needs a closed/open workflow RAF/long-task pressure case. |
| Task list | `task-list-perf.test.ts` covers 300 task rows and mission search timing. Latest observed: panel rows 263.5 ms, select last 18.4 ms, mission rows 161.9 ms, mission search 19.7 ms. | Timing coverage, not RAF/long-task coverage. |
| Long transcript | `long-transcript-scroll.test.ts` checks scroll anchoring in a synthetic page. | Not enough for real overlay render pressure. Needs long completed markdown hydration/scroll benchmark. |
| Agent rail | `conversation-agent-rail-scroll-browser.test.ts` covers drag/visibility. Source tests cover parent ID helpers and server-hydrated record source. | Functional/visual coverage; no dedicated RAF/long-task pressure case. |
| Browser Preview | `browser-preview-live-input-batch.test.ts` covers live input batching, layout-read avoidance, nonblank screenshot, and no hidden capture. A 2026-06-28 run exposed dropped click/wheel inputs; fixed by queuing pending point inputs until live image geometry is available. | Functional responsiveness path repaired; still lacks global RAF/long-task benchmark. |
| Screenshot browser | `screenshot-browser-panel-browser.test.ts` covers open RAF gaps, long tasks, thumbnail request bounds, virtualization, resize screenshots, and cancellation. | Strong covered surface. |
| File explorer | Existing browser tests cover accessibility, search errors, and focus visuals. Source audit found hidden search could still run when panel was inactive and large expanded trees are fully flattened before virtualization. Hidden search was repaired in this pass. | Hidden search repaired; large expanded-tree row materialization remains an open risk. |
| Settings / Skills / MCP | Visual and matrix-density tests exist. Source audit found permanently mounted hidden panels could still derive and render large matrix/list data while CSS-hidden. Compact Skills/MCP projections were active-scoped in this pass and browser tests now assert hidden panels do not materialize matrix/list DOM. | Hidden compact panel materialization repaired; settings dialog density/left-edge compact matrix visual polish remains a separate open risk. |

## 2026-06-28 Additional Finding

The Browser Preview live input benchmark originally failed after the stream-jank
fix pass:

```text
actual input kinds: ["key"]
expected input kinds: ["click", "wheel", "key"]
```

Root cause:

- Pointer and wheel events depended on an asynchronously measured live image
  rectangle.
- The image had decoded, but the measurement RAF had not necessarily completed
  before the user input events arrived.
- The event handlers avoided synchronous layout reads, as intended, but they
  dropped point-based inputs instead of preserving them until the measurement
  was ready.

Repair:

- Pending live inputs now distinguish ready key inputs from point inputs that
  carry raw client coordinates.
- Flush converts point inputs through the current task/target/viewport live
  image rectangle. If the rectangle is not ready, it schedules the same RAF
  measurement and keeps the inputs queued.
- The route contract remains strict `inputs[]`; no singular `input` fallback or
  hidden retry path was added.
- The fixture now models the real `/skill/mounts` startup route explicitly,
  following the skill mount matrix contract.

Verification:

- `bun test packages/overlay/test/browser-preview-panel.test.ts packages/overlay/test/browser-preview-service.test.ts --timeout 30000`
- `bun run --cwd packages/overlay typecheck`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/browser-preview-live-input-batch.test.ts`

## 2026-06-28 File Explorer Hidden Search Result

Root cause:

- `FileExplorerPanel` gated directory loading and selected-file expansion on
  `active()`, but the search resource source used only `query` and `directory`.
- Because center workbench panels remain mounted, a hidden Explorer search input
  with a stale non-empty query could still trigger `/find/file`.

Repair:

- The search resource source now returns `undefined` unless the Explorer panel
  is active and has a directory.
- Search still runs when the panel is opened or reopened with a non-empty query.
- No alternate file-search route, cache fallback, or hidden compatibility path
  was added.

Verification:

- `bun test packages/overlay/test/file-explorer-editor.test.ts --timeout 30000`
- `bun run --cwd packages/overlay typecheck`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/file-explorer-search-error.test.ts`
- Visual evidence:
  `.scratch/file-explorer-hidden-search-active-gate.png`

## 2026-06-28 Skills/MCP Hidden Projection Result

Root cause:

- The left Skills and MCP panels stay mounted as Solid roots even when their
  parent activity body is `data-active="false"`.
- Network effects were already active-gated, but visible projections still read
  shared stores and rendered the Skills matrix or MCP list while CSS-hidden.
- A large skill pool or many MCP rows could therefore spend DOM work on an
  inactive tool panel during unrelated overlay interactions.

Repair:

- `SkillMarketPanel` now derives `skillPanelActive`, `mcpPanelActive`, and
  `marketPanelActive` from the existing `active` owner.
- Skills, mount matrix, MCP rows, and market rows project from the shared
  `appStore` only while their mode is active.
- The visible panel sections are mounted through those same active projections.
  Settings continues to pass `active=true`, so the settings tabs preserve the
  same data and action paths.
- No second skill/MCP data source, fallback route, or throttled masking path was
  added.

Verification:

- `bun test packages/overlay/test/project-directory-request-loop.test.ts packages/overlay/test/left-activity-toolbar.test.ts --timeout 30000`
- `bun test packages/overlay/test/settings-primitives.test.ts packages/overlay/test/settings-status-labels.test.ts --timeout 30000`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/skill-mount-matrix-browser.test.ts packages/overlay/test/browser/skill-mcp-panel-browser.test.ts`
- Visual evidence:
  `.scratch/skill-mount-matrix-panel.png`,
  `.scratch/skill-mcp-status-pills.png`,
  `.scratch/skill-mcp-delete-confirm.png`,
  `.scratch/skill-mcp-delete-failure.png`

## Remaining Work

1. Add or extend a global live-pressure browser benchmark that opens a large
   selected task with conversation, workflow, agent rail, task list, browser
   preview, screenshot panel, and file/settings surfaces, then records RAF gaps,
   long tasks, mounted DOM counts, and route pressure.
2. Add a real overlay long completed markdown transcript benchmark before
   claiming long transcripts cannot jank during scroll/hydration.
3. Normalize task-list and browser-preview timing tests to include RAF/long-task
   probes rather than elapsed DOM-settle timing alone.
4. Revisit compact Skills matrix visual density/left-edge clipping separately;
   the active-unmount repair keeps the opened panel functional but did not
   redesign that matrix.
