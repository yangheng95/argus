# Overlay Global GUI Responsiveness Benchmark

Date: 2026-06-28
Status: implementation verified locally, pending commit/push

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
| Pre-June overlay streaming text main-thread plan | Streaming text must avoid full markdown parsing and workflow text projection on every delta. |
| Pre-June overlay scroll single-source plan | Scroll follow is driven by visible data version, not DOM mutation observation. |
| `2026-06-19-system-performance-high-confidence-pass.md` | Performance repairs require focused evidence and no user-running overlay restart. |
| `2026-06-22-browser-preview-live-input-batch-owner.md` | Browser Preview live input uses strict `inputs[]`, one in-flight owner, and no hidden evidence capture. |
| `2026-06-22-screenshot-browser-open-jank.md` | Screenshot browser opening must be virtualized, bounded, and frame-scheduled. |
| `2026-06-23-overlay-conversation-render-backpressure.md` | Agent rail uses server-hydrated records and parent IDs, not live card-tree scans. |
| `2026-06-23-agent-skill-mount-matrix.md` | `/skill/mounts` is the single skill matrix projection and browser fixtures must model it explicitly. |

## Coverage Matrix

| Surface | Current evidence | Status |
| --- | --- | --- |
| Conversation streaming | `conversation-stream-jank.test.ts` runs 120 history messages and 900 deltas with interval drift, long tasks, mounted card count, and screenshot. Latest observed after stream fix: drift 46.9 ms, 1 long task at 56.0 ms, 17 mounted cards. | Covered for the reproduced stream path. |
| Workflow / inspector | `workflow-generating-status-browser.test.ts` proves live workflow status without streamed body text. Stream and global benchmarks assert `workflowMessages=0`. | Covered in stream and global pressure paths. |
| Task list | `task-list-perf.test.ts` covers 300 task rows and mission search timing with per-action RAF and long-task probes. Latest observed in the high-signal group: panel workflow 783.6 ms / 44.2 ms RAF, select last 13.0 ms / 6.8 ms RAF, mission rows 84.0 ms / 21.0 ms RAF, mission search 19.9 ms / 7.0 ms RAF. | Covered for task and mission list pressure. |
| Long transcript | `conversation-long-transcript-markdown-browser.test.ts` loads the real overlay with 240 completed markdown messages, waits for transcript markdown prewarm, scrolls the chat surface, records RAF gaps, long tasks, mounted card count, markdown block count, and screenshot evidence. Latest observed in the high-signal group: RAF gap 48.5 ms, 1 long task, max long task 50.0 ms, 6 mounted cards. | Covered for completed markdown transcript scrolling. |
| Agent rail | `conversation-agent-rail-scroll-browser.test.ts` covers drag/visibility. Global pressure records horizontal scroll RAF/long-task metrics with 180 agent buttons mounted. | Covered in dedicated functional and global pressure paths. |
| Browser Preview | `browser-preview-live-input-batch.test.ts` covers live input batching, layout-read avoidance, nonblank screenshot, no hidden capture, and RAF/long-task probes for mixed input, wheel burst, and resized click. Latest observed in the high-signal group: mixed 7.1 ms RAF / 0 long task, wheel 7.0 ms RAF / 0 long task, resized click 7.1 ms RAF / 0 long task. | Covered for live input responsiveness. |
| Screenshot browser | `screenshot-browser-panel-browser.test.ts` covers open RAF gaps, long tasks, thumbnail request bounds, virtualization, resize screenshots, and cancellation. | Strong covered surface. |
| File explorer | Existing browser tests cover accessibility, search errors, and focus visuals. Source audit found hidden search could still run when panel was inactive and large expanded trees are fully flattened before virtualization. Hidden search was repaired in this pass. | Hidden search repaired; large expanded-tree row materialization remains an open risk. |
| Settings / Skills / MCP | Visual and matrix-density tests exist. Source audit found permanently mounted hidden panels could still derive and render large matrix/list data while CSS-hidden. Compact Skills/MCP projections were active-scoped, `/skill/mounts` is now the settings skill pool source, and the global benchmark records settings shell plus full matrix completion. | Hidden compact panel materialization repaired; settings matrix covered by browser and global pressure paths. |

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

2026-06-28 normalized metrics:

- Mixed click/wheel/key: RAF gap 7.1 ms, max long task 0.0 ms.
- Wheel burst: RAF gap 7.0 ms, max long task 0.0 ms.
- Resized visual-center click: RAF gap 7.1 ms, max long task 0.0 ms.

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

## 2026-06-28 Long Completed Markdown Transcript Result

Root cause:

- Conversation virtualization bounded DOM size, but completed markdown cards
  still parsed markdown synchronously the first time a virtual item mounted.
- The fixed `itemSize` estimate was tuned for short stream cards, so large
  completed markdown messages caused extra virtualizer correction work during
  scrollbar jumps.
- A long transcript could therefore stall a scroll frame even though only a
  small number of cards were mounted.

Repair:

- The central `renderMarkdown()` now owns a deterministic HTML cache, so
  repeated virtual remounts do not re-run `marked` and syntax highlighting.
- Conversation hydrate, tail merge, older-history load, and session-history
  load prewarm completed text/reasoning markdown through that same renderer
  before scroll interaction. Components still use the same `renderMarkdown`
  entry point; no alternate text renderer or fallback route was added.
- The conversation virtualizer estimate now matches completed markdown cards
  better, while overscan is kept narrow enough to avoid batch-mounting many
  heavy markdown cards in one frame.

Verification:

- `bun test packages/overlay/test/streaming-text-render.test.ts packages/overlay/test/markdown-safety.test.ts packages/overlay/test/message-url-preview.test.ts --timeout 30000`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/conversation-long-transcript-markdown-browser.test.ts packages/overlay/test/browser/conversation-stream-jank.test.ts packages/overlay/test/browser/conversation-agent-rail-scroll-browser.test.ts`
- Visual evidence:
  `.scratch/overlay-long-markdown-transcript-scroll.png`

## 2026-06-28 Task List RAF/Long-Task Normalization Result

Result:

- `task-list-perf.test.ts` now records RAF gaps and long tasks for task row
  expansion/pagination/search, task selection, Mission row pagination, and
  Mission search.
- The benchmark tool was corrected to ignore the probe startup frame so it
  measures the interaction, not prior page-settle time.

Verification:

- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/task-list-perf.test.ts`
- Latest high-signal metrics: panel workflow 783.6 ms / 44.2 ms RAF, select
  last 13.0 ms / 6.8 ms RAF, Mission rows 84.0 ms / 21.0 ms RAF, Mission
  search 19.9 ms / 7.0 ms RAF.

## 2026-06-28 Global Live Pressure Benchmark Result

Benchmark:

- Added `packages/overlay/test/browser/overlay-global-live-pressure-browser.test.ts`.
- The fixture opens and exercises the real overlay with:
  - 180 conversation messages and long completed markdown text.
  - Workflow panel open while conversation owns streamed text.
  - 180 agent rail buttons.
  - 160 task rows.
  - Browser Preview shell, image completion, and live input.
  - Screenshot panel shell plus full rendered item count and thumbnail completion.
  - File explorer open and search.
  - Settings skill dialog shell and full 24 skill x 8 agent matrix completion.
- The benchmark records per-action RAF gaps, long tasks, mounted DOM counts,
  request pressure, and `.scratch/overlay-global-live-pressure.png`.

Latest verified result after the screenshot and settings repairs:

```text
open tasks=40.7raf/0.0lt/0long
open browser preview shell=17.8raf/0.0lt/0long
complete browser preview image=27.7raf/0.0lt/0long
browser live input=11.6raf/0.0lt/0long
open screenshots shell=30.2raf/0.0lt/0long
complete screenshot thumbnails=55.4raf/76.0lt/1long
open explorer=97.6raf/66.0lt/1long
file explorer search=35.2raf/0.0lt/0long
scroll conversation with panels=101.2raf/103.0lt/6long
scroll agent rail=13.6raf/0.0lt/0long
open settings menu=28.1raf/0.0lt/0long
open settings skill dialog shell=110.9raf/0.0lt/0long
complete settings skill matrix=7.1raf/0.0lt/0long
dom={"mountedConversationCards":6,"workflowMessages":0,"agentRailButtons":180,"screenshotCards":6,"fileRows":28,"skillCells":192}
requests={"attachmentRequestCount":6,"liveSnapshotRequestCount":1,"liveInputRequestCount":1,"fileListRequestCount":1,"fileSearchRequestCount":1}
```

Verification command:

- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/overlay-global-live-pressure-browser.test.ts`

## 2026-06-28 Screenshot Browser Shell Result

Root cause:

- Opening the screenshots panel made the center workbench mark the panel open
  and then mounted screenshot groups/rows in the same interaction window.
- A single render of the complete screenshot row model kept `open screenshots
  shell` near or above the 120 ms RAF cap even though thumbnail network loading
  was already frame-pumped.

Repair:

- `ScreenshotBrowserPanel` keeps `cardTreeStore.screenshotItems` as the single
  source, but exposes `data-item-count` and `data-rendered-count` and renders
  screenshot items into the virtualized row model in fixed RAF batches.
- The header count still reports the true source count immediately.
- The global benchmark's screenshot completion step waits for
  `rendered-count >= item-count` before accepting visible thumbnails, so the
  shell metric cannot pass by leaving the real work unmeasured.

Verification:

- `bun test packages/overlay/test/screenshot-browser-panel.test.ts --timeout 30000`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/screenshot-browser-panel-browser.test.ts`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/overlay-global-live-pressure-browser.test.ts`
- Visual evidence:
  `.scratch/screenshot-browser-panel-browser.png`,
  `.scratch/overlay-global-live-pressure.png`

## 2026-06-28 Settings Dialog Functionality Review

Findings from read-only peer review were valid:

- Config dialog body mount moved to RAF, but `focusConfigSection()` still used
  microtasks and could scroll before `#channelList`, `#mcpList`, or
  `#skillMarketList` existed.
- Fullscreen non-modal config dialog content used the same z-index as ordinary
  overlays, while the titlebar used the dialog layer and could intercept the
  settings close button.
- The skill matrix still allowed `mounts()?.skills ?? skills()`, creating a
  second settings pool source after the `/skill/mounts` single-source plan.

Repairs:

- Config section focusing is now explicitly scheduled after dialog frames and
  canceled on close.
- `.dialog` content uses `--ui-z-dialog`; `.dialog-overlay` remains
  `--ui-z-overlay`, preserving non-modal pointer behavior.
- Settings skill pool now derives from `/skill/mounts` only. Installed skills
  remain available through `loadInstalledSkills()` for delete reconciliation,
  not as a settings matrix fallback source.
- Prompt preview attached card min-height was restored to the existing 160 px
  settings contract after the focused config suite exposed a regression.

Verification:

- `bun test packages/overlay/test/dialog-primitive.test.ts packages/overlay/test/dialog-service-single-source.test.ts packages/overlay/test/config-panel-sizing.test.ts --timeout 30000`
- `bun test packages/overlay/test/project-directory-request-loop.test.ts packages/overlay/test/extensions-service.test.ts --timeout 30000`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/config-dialog-resizer.test.ts packages/overlay/test/browser/settings-channel-extension-head.test.ts packages/overlay/test/browser/skill-mcp-panel-browser.test.ts packages/overlay/test/browser/skill-mount-matrix-browser.test.ts`

## Remaining Work

1. Commit and push the verified overlay responsiveness repair from the current
   main worktree after staging only task-related files.
2. Run the repository pre-push hook path. If unrelated dirty files block the
   hook, record the exact blocker and do not create another worktree.
