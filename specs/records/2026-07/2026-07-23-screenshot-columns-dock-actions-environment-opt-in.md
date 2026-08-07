# Screenshot Columns, Right Dock Actions, And Environment Opt-In

## Recall

### User requirement

The supplied desktop screenshots identify three Overlay defects:

1. the Screenshots tool renders only three cards per row even when the Right
   Dock has enough unused width for more stable-size cards;
2. the Right Dock add and close actions are visually undersized; and
3. Environment Information opens automatically whenever the operator enters an
   active Task.

### Acceptance criteria

- Screenshots retain the existing fixed `132px` logical card and thumbnail
  width, but the row column count uses every complete card slot available in
  the measured list width. Narrow panels still render at least one column and
  never stretch or clip cards.
- Right Dock add and close use the shared icon-button density
  (`--oc-density-icon-button`) and standard Icon tier instead of the
  tab-local `28px` control and compact `12px` glyph. The selected tab and its
  embedded close action retain their existing compact geometry.
- Entering, re-entering, or observing an active Task does not open Environment
  Information. The existing toolbar click and hover interactions remain the
  only presentation actions; hiding the chat-header anchor still closes the
  controlled Popover.
- The existing Solid, Kobalte, Virtua, Button, Icon, ResizeObserver, and
  request-animation-frame owners remain in place. No fallback layout, second
  visibility source, local storage, iframe, or parallel panel is introduced.
- Focused source tests, Overlay typecheck/build, Node-launched browser
  fixtures, original-resolution screenshots, personal visual review,
  documentation health, and a second diff review pass.

### Hard constraints

- Desktop-only scope.
- Do not restart, refresh, resize, close, or otherwise interfere with the
  user's running OpenCorvus or Overlay process. Browser validation uses
  isolated Node-launched fixtures.
- Playwright runs through Node, not Bun.
- Preserve the fixed thumbnail-size decision; width changes reflow columns
  without stretching cards.
- The current branch and worktree remain the only delivery source. Commit
  subjects start with `dsw-33987` and push through normal hooks to `myhexin`.

### Supplied evidence

- Screenshot-column defect:
  `C:/Users/10132/AppData/Local/Temp/codex-clipboard-0ccb9287-040f-4d6c-ac86-ca9300de69af.png`.
- Right Dock action-size defect:
  `C:/Users/10132/AppData/Local/Temp/codex-clipboard-0cc482d3-1c60-4757-b14f-a1fd370bb778.png`.
- Automatically presented Environment Information:
  `C:/Users/10132/AppData/Local/Temp/codex-clipboard-69a6ff34-a263-4e8d-a7ea-db3db4512a7d.png`.
- All three images were inspected at original resolution before planning.

### Material read

- `AGENTS.md` and the Browser control skill.
- `specs/current/architecture/07-panel.md` and
  `specs/current/architecture/99-principles.md`.
- `2026-06-28-screenshot-browser-stable-thumbnail-size.md`.
- `2026-07-18-review-codex-reference-parity.md`.
- `2026-07-17-environment-popover-codex-completion.md`.
- `2026-07-21-environment-popover-task-start-and-chat-clearance.md`.
- Current Screenshot Browser, Right Dock, Environment Information, shared
  Button/Icon primitives, their style owners, and focused source/browser tests.

### Whole-repository search and call-point disposition

The investigation covered every occurrence of
`SCREENSHOT_BROWSER_MAX_COLUMNS`, `SCREENSHOT_BROWSER_CARD_WIDTH`,
`columnCount`, `buildScreenshotBrowserRows`,
`--screenshot-browser-columns`, `.right-dock-add`, `.right-dock-close`,
`--right-dock-control-height`, `startedTaskRunKey`,
`presentedTaskRunKeys`, `taskRuntimeActivityKey`, and
`project-runtime-status-dropdown` across `packages/overlay`, current
architecture, and June/July records.

| Owner / call point | Evidence and disposition |
| --- | --- |
| `ScreenshotBrowserPanel.tsx` | The width calculation divides the measured list width by fixed card width plus gap, then explicitly clamps with `SCREENSHOT_BROWSER_MAX_COLUMNS = 3`. Delete only that cap and keep the existing measured-width, UI-scale, Virtua row, and fixed-card sources. |
| `utils/screenshot-browser.ts` | `buildScreenshotBrowserRows(groups, columns)` already accepts any positive column count and chunks each owner group accordingly. Keep unchanged. |
| `activity.css` | Grid tracks already use fixed `--screenshot-browser-card-width`; keep unchanged so added columns do not stretch thumbnails. |
| `screenshot-browser-panel.test.ts` | Add a source regression that rejects a maximum-column cap while retaining fixed-width, measured reflow, virtualization, and no-stretch contracts. |
| `screenshot-browser-panel-browser.test.ts` | Add wide-panel computed geometry proving more than three columns, stable card width, complete use of available slots, no horizontal overflow, and a task-scoped screenshot. Preserve narrow-panel coverage. |
| `RightDock.tsx` | The add and Dock-close actions are the supplied actions and already use shared Button/Icon primitives. Promote only their Icon tier from compact to standard. Tab-close remains compact. |
| `workspace.css` | One grouped selector overrides tab-close, add, and Dock-close to the tab-local `28px` size. Split ownership: tab-close keeps the tab control height; add and Dock-close consume the canonical icon-button density. |
| `right-dock-panel-ownership.test.ts`, `review-changes-empty-dock-browser.test.ts`, `titlebar-toolbar-toggle-browser.test.ts` | Replace the obsolete “all three controls are 28px/12px” contract with compact tab-close plus canonical add/Dock-close geometry. Keep header, tab, menu, focus, overflow, and interaction coverage. |
| `TaskDirBar.tsx` | The active Task effect computes `taskID:time.started`, remembers it in `presentedTaskRunKeys`, and calls `openRuntimePanel`; this is the direct auto-open trigger. Delete the effect, memo, set, and now-unused import. Keep explicit toolbar/hover and child-navigation calls to `openRuntimePanel`. |
| `task-cwd-row-layout.test.ts`, `task-dirbar-keyboard.test.ts` | Replace start-auto-open assertions with a negative regression: active Task entry and task switching leave `aria-expanded=false`, then explicit hover/click opens the same Popover. Preserve controlled anchor-hide, child navigation, and panel-content coverage. |
| `07-panel.md` | Supersede the 2026-07-21 auto-presentation clause with explicit operator presentation only. Preserve the independent content disclosure and wide-container clearance while the Popover is actually open. |

No backend route, transport contract, database field, locale key, screenshot
source, thumbnail cache, or second Right Dock/Environment mount participates.

### Independent agent feedback

None. The user did not request sub-agents, and current collaboration policy
forbids unrequested delegation.

### Git baseline

Branch `work-v0.0.16beta-yr-0723` is clean at `5402cd65c`, equal to
`myhexin/work-v0.0.16beta-yr-0723`. The preceding Overlay refinement was
committed and pushed before this plan.

## Causal chain

1. The Screenshot Browser already measures the correct list width and already
   owns fixed card geometry. The visible whitespace is not a CSS-grid defect;
   it is caused directly by clamping the valid measured slot count to three.
2. Right Dock add/close pass through the canonical Button primitive, but a
   feature selector replaces its `32px` icon-button density with the `28px`
   tab-control density and the component asks for compact `12px` glyphs. The
   selected tab needs that compact density; the global add/close actions do
   not.
3. Environment visibility is not being restored by Kobalte or task selection
   state. A dedicated Task-run effect explicitly invokes `openRuntimePanel`.
   Removing that producer leaves one controlled Popover and its existing
   explicit operator interactions.
4. The earlier 2026-07-21 behavior intentionally added Task-start
   auto-presentation. The current user requirement explicitly reverses that
   interaction, so preserving the old one-shot memory would retain the defect
   rather than provide compatibility.

## Implementation and verification plan

1. Commit and push this Recall and index update before production edits.
2. Add focused failing source/browser expectations for unbounded complete-card
   reflow, canonical add/close action density, and no Task-entry Environment
   presentation.
3. Remove the Screenshot Browser cap, split Right Dock action geometry from
   tab-close geometry, and delete the Task-start Environment presentation
   producer plus its obsolete runtime-identity dependencies.
4. Update current architecture and run focused source tests, Overlay typecheck,
   internationalization check, and production build.
5. Run the existing Node-launched Screenshot Browser, Right Dock, and
   Environment fixtures in isolated processes. Capture the wide screenshot
   grid, corrected Dock actions, and active-Task closed Environment state.
6. Inspect each screenshot at original resolution, correct any layout or
   interaction mismatch, rerun affected checks, and perform a second full diff
   review.
7. Run required historical-link/document-health checks, commit the exact
   task-owned files with `dsw-33987`, fetch/converge if the remote advanced,
   push to `myhexin`, and verify local/remote equality.

## Progress

- [x] Supplied images inspected at original resolution.
- [x] Rules, architecture, history, production owners, tests, and complete call
  sites inspected.
- [x] Recall, causal chain, and verification plan recorded.
- [x] Plan committed and pushed (`eb2a448c6`).
- [x] Focused regressions added.
- [x] Production implementation complete.
- [x] Static, browser, and visual verification complete.
- [x] Second review complete.
- [x] Delivery commit `26cf45457` and git-cc push complete.

## Result

- Screenshot Browser column calculation now uses every complete fixed-width
  card slot in the measured panel width, without a three-column ceiling.
- Right Dock tab-close remains `28px` with a compact glyph, while the global
  add and Dock-close actions use the shared `32px` icon-button density and
  standard `14px` glyph.
- Task entry no longer presents Environment Information. Toolbar click and
  direct hover still open the same controlled Popover.
- Current panel architecture now records these three single-source contracts.

## Visual acceptance

- `.scratch/screenshot-browser-panel-browser-wide-columns.png`: inspected at
  original `1100x779` resolution; the wide Dock renders four complete fixed
  columns and leaves less than one card slot unused.
- `.scratch/right-dock-review-changes-only.png` and
  `.scratch/right-dock-many-tabs-stable.png`: inspected at original
  resolution; global actions have the corrected visual weight while tab
  geometry remains compact.
- `.scratch/task-dirbar-runtime-status-task-entry-closed.png`: inspected at
  original `1120x760` resolution; the active Task is visible and Environment
  Information remains closed.
- The images were also loaded through the isolated in-app Browser surface;
  DOM inspection confirmed complete image resources and their natural
  dimensions. The helper served only `.scratch` and was stopped after review.
  No running OpenCorvus or Overlay process was modified.

## Verification evidence

- `bun test` focused Overlay source, browser-sidecar ownership, and
  density/continuity suite: 71 passed, 0 failed.
- Overlay TypeScript typecheck and panel internationalization check: passed.
- Node-launched `task-dirbar-keyboard.test.ts`: 16 passed, 0 failed.
- Node-launched Screenshot Browser, empty Right Dock, and titlebar toolbar
  fixtures: passed. Their assertions cover wide-column geometry, overflow,
  action/icon dimensions, tab geometry, menu stability, and explicit
  Environment presentation.
- The Screenshot Browser fixture passed five consecutive isolated runs after
  its observation repair, followed by the combined final browser pass.
- The production Vite build executed by the Right Dock browser fixture:
  passed; only the pre-existing chunk-size advisory was emitted.
- Historical links, document health, and product documentation single-source
  suites: 87 passed, 0 failed.
- `git diff --check`: passed.

The Screenshot Browser fixture initially exposed stale fixture data after the
conversation contract became strict: transcript messages lacked the canonical
`sessionAgentID`, and the fixture did not serve the goal-run diff endpoint.
The fixture was corrected to use the production contract. Repeated runs then
proved that the sidecar's page-local `waitForFunction` could time out even
though diagnostics showed every visible image fully decoded. The readiness
check now uses the repository's host-side observed-activity owner. Wide-layout
evidence also waits for newly visible thumbnails before capture. No timeout
relaxation, fallback, or alternate screenshot source was introduced.

## Second review

The final diff was re-read against all three supplied screenshots and the
whole-repository call-point inventory. The implementation changes the existing
layout calculation, shared action geometry, and controlled Popover producer
directly. It does not add a second source, compatibility path, gate, storage
state, backend route, or alternate panel.
