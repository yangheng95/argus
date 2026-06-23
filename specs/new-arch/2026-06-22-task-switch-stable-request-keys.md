# Task Switch Stable Request Keys

Date: 2026-06-22
Status: Verified

## Acronyms

- GUI: Graphical User Interface, the rendered overlay surface.
- UI: User Interface, visible controls and panels.
- RAF: Request Animation Frame, the browser callback used to run visual work once per frame.
- CLI: Command-Line Interface, an external command tool launched from the overlay.

## Task Definition

Reduce task-switch request fan-out after the selected task directory source was
fixed. The next measurable target is duplicate project-control requests for the
same directory and task context: `terminal/profiles`, `coding/cli/profiles`,
`task/:id/operator-model-context`, and Hexin budget checks.

## Recall

| Source | Constraint carried forward |
| --- | --- |
| `AGENTS.md` | No fallback, no duplicate source, recall plans before edits, test every change, visually verify UI work, commit and push each round. |
| `2026-06-19-deep-performance-investigation.md` | Always-mounted panels can amplify task selection pressure; fix trigger-level causes instead of broad stale caches. |
| `2026-06-22-task-switch-directory-source.md` | Selected task directory ownership is now fail-loud and uses `taskOwningDirectory()` as the owner. |
| `ExecutorSelector.tsx` | Task operator model context is loaded via Solid `createResource` keyed by task ID, active directory, and session config refresh token. |
| `WorkspaceLayoutControls.tsx` / `WorkspaceCodingCliLaunchers.tsx` | Both always-mounted TaskDirBar controls load terminal profile data. |

## Call Point Inventory

| Surface | Evidence | Decision |
| --- | --- | --- |
| `ExecutorSelector` task context resource | `taskOperatorContextKey` returns a new object for the same task/directory/refresh values whenever dependencies re-run. | Encode the key as a stable string and parse it in the fetcher. |
| `ExecutorSelector` Hexin budget resource | `hexinBudgetBaseKey` and `hexinBudgetKey` return fresh objects. | Use stable string keys so identical budget inputs do not refetch. |
| `WorkspaceLayoutControls` | A `createEffect` calls `activeDirectory()` and reloads terminal profiles on every dependency invalidation. | Track a normalized directory memo and reload only when that string changes. |
| `WorkspaceCodingCliLaunchers` | A separate `createEffect` reloads coding CLI profiles and calls `reloadTerminalProfileSelection()` for the same directory. | Track the same normalized directory key and rely on the terminal selection service to coalesce same-directory in-flight loads. |
| `terminal-selection` | `reloadTerminalProfileSelection()` directly calls `listTerminalProfiles()` for every caller. | Add one in-flight owner per directory; duplicate concurrent callers await the same request and share the same failure. |
| Ampere read-only agent | Prompt-profile still falls through to project catalog while selected task root session is unresolved; compact memory also loads while inactive. | Defer these separate trigger roots to follow-up rounds instead of mixing them into the stable-key change. |

## Root Cause

The previous fix removed stale previous-directory requests, but several
always-mounted project controls still observe broad reactive sources. Solid
effects and resources can re-run when underlying board/source objects change
even if the semantic directory or task context string is unchanged. Returning
fresh object keys from `createMemo` amplifies this into duplicate HTTP requests.
The terminal launcher path also has two mounted callers for the same terminal
profile endpoint.

## Fix Plan

1. Replace object-valued `ExecutorSelector` resource keys with stable encoded
   string keys.
2. Parse resource keys at the fetch boundary and fail if their shape is invalid.
3. Make workspace launcher effects depend on normalized directory strings, not
   broad `activeDirectory()` internals.
4. Coalesce concurrent same-directory terminal profile reloads in
   `terminal-selection`.
5. Add tests for stable executor key ownership and terminal reload coalescing.
6. Rerun the real task-switch visual/request probe.

## Acceptance

- Re-rendering or board hydration with unchanged task ID, directory, and
  refresh token does not create a new task operator context key.
- Terminal profile reloads for the same directory share one in-flight request.
- Workspace launcher controls reload only when the normalized directory string
  changes.
- No stale cache, fallback, hidden route, or alternate profile source is added.
- Focused tests, overlay typecheck/build, visual QA, self-review, commit, and
  push pass.

## Implementation

- `ExecutorSelector` now encodes task operator context and Hexin budget
  resource keys as stable strings, and parses those keys at the fetch boundary.
- `WorkspaceLayoutControls` and `WorkspaceCodingCliLaunchers` now reload only
  when their normalized directory string changes.
- `terminal-selection` now owns one same-directory in-flight terminal profile
  reload so the terminal launcher and CLI launcher do not double-hit the
  terminal profile endpoint.

## Verification

| Check | Result |
| --- | --- |
| `bun test packages/overlay/test/executor-selector-dualbar.test.ts --timeout 30000` | 59 pass |
| `bun test packages/overlay/test/terminal.test.ts --timeout 30000` | 4 pass |
| `bun run --cwd packages/overlay typecheck` | Pass |
| `bun run --cwd packages/overlay build:vite` | Pass |
| `OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER=1 node --test --test-concurrency=1 packages/overlay/test/browser/executor-selector-task-model-context.test.ts` | 2 pass |
| `node packages/overlay/.scratch/task-select-directory-window.mjs` | Request count 38, stale previous-directory requests 0, visible cards 31; `terminal/profiles=1`, `coding/cli/profiles=1`; screenshot `.scratch/task-select-directory-window-tsk_edc1eeb470011vW1ZfiEsw7ijo.png` reviewed. |

## Deferred Findings

- `config/prompt-profile` still fires repeatedly during task switch. Ampere's
  read-only audit traced this to the composer effect requesting project-level
  prompt profiles before `rootTaskSessionID()` is resolved, then requesting the
  task session catalog later.
- `panel/knowledge/memory` still fires repeatedly because compact memory
  surfaces remain active enough to load during task switches.
- `operator-model-context` can still appear twice when
  `sessionConfigRefreshToken()` legitimately changes; this is not the same bug
  as the previous object-identity resource key churn.

## Follow-up 2026-06-23: Inactive Compact Memory Request Owner

### Recall

| Source | Constraint carried forward |
| --- | --- |
| `AGENTS.md` | No fallback, no double source, recall before edit, test every code change, visual QA for UI changes, commit and push. |
| This spec | Compact memory loading was deferred as a separate trigger root after stable request keys were fixed. |
| `MemoryPanel.tsx` | `props.compact` currently bypasses the inactive guard before calling `loadMemory`. |
| `main.tsx` | The left Memory panel is always mounted as `compact`, with `active={selectedLeftPanelActivity() === "memory"}`. |
| `left-tool-panels-directory-browser.test.ts` | The real left activity flow already verifies Skill, MCP, and Memory panels against a task-scoped fixture. |

### Call Point Inventory

| Surface | Evidence | Decision |
| --- | --- | --- |
| `MemoryPanel` automatic reload effect | `if (!isActive() && !props.compact) return` means compact panels load while hidden. | Make `active` the single owner of automatic memory loading; compact is only visual density. |
| Left activity Memory mount | Always mounted, compact, inactive unless the activity button is selected. | Do not request memory until that activity is selected. |
| Settings Memory tab | Uses the default active value when rendered in its selected tab. | Preserve default active behavior by keeping `props.active ?? true`. |
| Manual refresh/search/detail/delete | User-triggered inside the visible panel. | Leave unchanged; these actions already require visible controls. |

### Fix Plan

1. Change the automatic memory reload effect so inactive panels do not call
   `loadMemory`, regardless of compact density.
2. Update static ownership tests to reject the old compact bypass.
3. Extend the browser left-tool panel test to prove no Memory request is sent
   before the Memory activity is selected, and that a request is sent after
   selection.
4. Rerun focused static tests, overlay typecheck, browser visual QA, and review
   screenshots.

### Acceptance

- Hidden compact Memory surfaces do not request `panel/knowledge/memory`.
- Selecting the Memory activity still loads the selected task directory.
- No cache, fallback, route bypass, or alternate memory source is added.
- Focused tests, overlay typecheck, browser visual screenshots, self-review,
  commit, and push pass.

### Implementation

- `MemoryPanel` now treats `active` as the only automatic load owner. Compact
  density no longer bypasses the inactive guard.
- Static ownership tests reject the previous compact bypass.
- The left-tool browser flow now asserts no Memory request is sent during
  initial load or while Skill/MCP activities are selected, then verifies the
  first Memory request after clicking the Memory activity carries the selected
  task ID and workspace directory.

### Verification

| Check | Result |
| --- | --- |
| `bun test packages/overlay/test/memory-panel-detail-dialog.test.ts packages/overlay/test/project-directory-request-loop.test.ts --timeout 30000` | 14 pass |
| `bun run --cwd packages/overlay typecheck` | Pass |
| `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/left-tool-panels-directory-browser.test.ts` | 1 pass |
| Visual QA | Reviewed `.scratch/left-skill-panel-primitive-row.png`, `.scratch/memory-row-sibling-controls.png`, and `.scratch/memory-panel-delete-empty-state.png`. |
| `git diff --check -- packages/overlay/src/components/MemoryPanel.tsx packages/overlay/test/memory-panel-detail-dialog.test.ts packages/overlay/test/project-directory-request-loop.test.ts packages/overlay/test/browser/left-tool-panels-directory-browser.test.ts specs/new-arch/2026-06-22-task-switch-stable-request-keys.md` | Pass |

### Self Review

- The change removes a trigger source; it does not introduce a stale cache,
  fallback route, or alternate memory store.
- Settings Memory keeps its default active behavior through `props.active ??
  true`.
- Manual refresh, search, detail, and delete paths stay unchanged and remain
  user-triggered inside the visible panel.

## Self Review

- The change does not add stale caches: terminal profile in-flight ownership is
  only for concurrent same-directory calls and clears when the request settles.
- Resource key parsing fails loudly on malformed keys; it does not silently
  fall back to project config or old values.
- The visual screenshot shows the selected `economy_8` task rendered with
  workflow content, composer controls, and right toolbar visible.
