# Overlay Panel Legal Size Contract

Date: 2026-06-23
Status: Verified

## Acronyms

- CSS: Cascading Style Sheets, the browser styling and layout language.
- GUI: Graphical User Interface, the visible overlay surface.
- QA: Quality Assurance, the verification pass that checks delivered behavior.
- UI: User Interface, visible controls and layout surfaces.

## Task Definition

Keep overlay panel geometry inside the existing legal size contract. Runtime
panels must not use illegal aspect-ratio viewports or shrink below their token
owned minimum widths when toolbar panels open or the window is resized.

## Recall

| Source | Constraint carried forward |
| --- | --- |
| `AGENTS.md` | No fallback logic, no duplicate source, no blind patching, test every change, visually verify UI work, and commit/push every round. |
| `2026-06-22-overlay-viewport-size-contract.md` | The native overlay minimum is `1120x720`; pane and center workbench minimum widths are token-owned. |
| `2026-06-22-overlay-layout-aspect-frame.md` | Legal overlay layout frame is constrained from the same minimum size tokens; do not reintroduce native resize feedback loops. |
| `2026-06-22-center-workbench-panel-min-size-contract.md` | `--ui-workbench-panel-min-width` remains the only center workbench panel minimum width source. |
| `2026-06-22-pane-semantics-layout-frame.md` | Pane layout and resize semantics remain owned by `services/pane.ts` and token-resolved CSS variables. |
| Hume read-only audit | `body[data-resizing="true"] .pane-resizer::before` is high-confidence dead CSS; live pane drag uses `.pane-resizer::after`. |
| User feedback 2026-06-23 | Limit aspect ratio and minimum panel width; illegal aspect ratios and too-small panels are not acceptable. |

## Call Point Inventory

| Surface | Evidence | Decision |
| --- | --- | --- |
| Overlay aspect frame | `base.css` and `overlay-layout-frame.ts` already derive layout height from `--ui-overlay-min-width` and `--ui-overlay-min-height`. | Keep the single source; this round does not add a second aspect constant. |
| Center workbench panel minimum | `workspace.css` gives open center panels `min-width: var(--ui-workbench-panel-min-width)`. | Keep; tests already cover three open panels. |
| Center workbench separator range | `main.tsx` used `Math.min(Math.max(raw, min), totalWidth - min)`, which can produce a value below `min` when `totalWidth < min * 2`. | Add a pure legal range helper and disable separator writes when adjacent panels cannot both satisfy the token minimum. |
| Left activity shell minimum | `activity.css` declares `min-width: min(100%, calc(var(--ui-collapsed-pane-width) + var(--ui-rail-min-width)))` and then overrides it with `min-width: 0` in the same rule. | Remove the overriding declaration; this is the concrete illegal small-panel source. |
| Pane drag cursor CSS | `workspace.css` still targets `body[data-resizing="true"] .pane-resizer::before`, but no `.pane-resizer::before` pseudo element exists. | Delete only that selector branch and keep the live `::after` hit area. |
| Static tests | `left-activity-toolbar.test.ts` and `pane-config.test.ts` inspect these CSS contracts. | Extend them to guard the token minimum and dead selector removal. |
| Browser tests | Existing left-pane and side-activity browser tests capture resize and toolbar visuals. | Re-run them and inspect screenshots for visual QA. |

## Root Cause

The panel size contract had one local double source in `activity.css`: the left
activity shell declared the correct token-owned minimum width, then later in
the same rule set `min-width: 0`. Under flex pressure this makes the shell's
actual CSS contract different from `services/pane.ts` and the layout token
source, so the left panel can become an illegal small panel even though the
token exists.

The pane-resizer `::before` selector is separate dead CSS. Leaving it in the
active resize cursor group preserves a non-existent pseudo-element contract and
weakens future audits of resize styling.

Follow-up 2026-06-23: the center workbench separator math still had an
impossible-range edge case. If stale CSS or a constrained fixture produced an
adjacent pair whose `totalWidth` was smaller than `2 * --ui-workbench-panel-min-width`,
the clamp expression selected `totalWidth - minWidth`, which is below the
minimum. That could persist illegal `centerWorkbenchPanelWeights` instead of
refusing the resize.

## Fix Plan

1. Remove the overriding `min-width: 0` from `.left-activity-shell`.
2. Remove `body[data-resizing="true"] .pane-resizer::before` from the resize
   cursor selector list.
3. Add static tests that the left shell has exactly the token-owned minimum
   width and no same-rule zero override.
4. Add static tests that pane resize keeps the live `::after` selector and has
   no `::before` branch.
5. Add a pure center workbench legal range helper and tests for unsatisfiable
   adjacent panel widths.
6. Disable center workbench separators when no legal range exists, and reject
   weight writes for that case.
7. Run focused unit/static tests, overlay typecheck, browser visual tests,
   screenshot review, self-review, commit, and push.

## Acceptance

- `.left-activity-shell` cannot override its token minimum width with
  `min-width: 0`.
- Pane and center workbench minimums continue to come from layout tokens.
- Adjacent center workbench separators cannot write weights when both panels
  cannot satisfy `--ui-workbench-panel-min-width`.
- Overlay aspect-ratio handling remains the existing legal layout-frame source;
  no alternate size source is added.
- The dead pane-resizer `::before` cursor selector is gone.
- Focused tests, browser visual QA, self-review, commit, and push pass.

## Verification

- PASS: `bun test packages/overlay/test/left-activity-toolbar.test.ts packages/overlay/test/pane-config.test.ts packages/overlay/test/pane-resizer-css.test.ts --timeout 30000`.
- PASS: `bun test packages/overlay/test/center-workbench-size.test.ts packages/overlay/test/pane-config.test.ts packages/overlay/test/overlay-layout-frame.test.ts packages/overlay/test/overlay-window-size-contract.test.ts packages/overlay/test/workspace-surface-consistency.test.ts --timeout 30000`.
- PASS: `bun run --cwd packages/overlay typecheck`.
- PASS: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/side-activity-toolbar-browser.test.ts packages/overlay/test/browser/left-pane-resizer-browser.test.ts`.
- PASS: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/center-workbench-separator-browser.test.ts`.
- Visual QA reviewed:
  `.scratch/left-activity-toolbar-current-page.png`,
  `.scratch/left-pane-resizer-desktop-resize.png`,
  `.scratch/left-pane-resizer-component-compact-resize.png`, and
  `.scratch/left-pane-resizer-restored-desktop-resize.png`.
- Follow-up visual QA reviewed:
  `.scratch/center-workbench-three-panel-min-width-1120.png`,
  `.scratch/center-workbench-illegal-tall-aspect-frame.png`, and
  `.scratch/center-workbench-separator-restored-desktop-resize.png`.

## Self Review

- Rechecked `.left-activity-shell`; the rule now has exactly one `min-width`
  declaration and it points at `--ui-rail-min-width` plus the activity toolbar
  width.
- Rechecked pane resize cursor CSS; the live `body[data-resizing="true"]`
  group keeps `.pane-resizer::after` and no longer references a non-existent
  `.pane-resizer::before`.
- Rechecked the browser test failure from the first run; the old `390px`
  assertion was treating an illegal viewport as a fully operable layout. The
  updated browser coverage now verifies the legal frame width instead of
  requiring all buttons to hit-test inside an illegal viewport.
- Rechecked the multi-panel separator drag failure; with the restored left
  shell minimum, `1440px` does not provide enough slack for a fixed `50px`
  resize assertion across four open center panels. The test now verifies that
  non-workflow separator dragging works in a wider normal-ratio desktop
  viewport without compressing panels below their token minimum.
- Rechecked the follow-up range helper; it receives the token-resolved minimum
  and returns `null` instead of inventing a smaller emergency minimum, so it
  does not add a fallback size source.

## Follow-up 2026-06-23: Pane Chrome Reserve

### Recall

| Source | Constraint carried forward |
| --- | --- |
| User feedback 2026-06-23 | Aspect ratio and minimum panel width are hard legality constraints; illegal aspect ratios and too-small panels are not acceptable. |
| `2026-06-22-overlay-viewport-size-contract.md` | The operable native frame is `1120x720`; browser layout tokens mirror this source. |
| `2026-06-22-pane-semantics-layout-frame.md` | `services/pane.ts` owns pane layout and separator ARIA, with no `main.tsx` duplicate writer. |
| `2026-06-22-center-workbench-panel-min-size-contract.md` | Open center panels keep `--ui-workbench-panel-min-width`; constrained peer panels scroll instead of compressing. |
| `2026-06-23-center-workbench-frame-phase-split.md` | Resize and toolbar-open work must remain frame-split; do not add synchronous geometry work to click paths. |

### Call Point Inventory

| Surface | Evidence | Decision |
| --- | --- | --- |
| Left activity toolbar | `#solidLeftActivityToolbar` is fixed chrome inside the left shell; `sidebarWidth` only represents `#sidebar`. | Add it to `PANEL_PANE_CONFIG` as left fixed chrome, so sidebar max cannot consume that width implicitly. |
| Right activity toolbar | `#solidRightActivityToolbar` is fixed chrome inside `#workspaceMain`; the current pane max only reserves `--ui-chat-min-width`. | Add it to `PANEL_PANE_CONFIG` as remaining fixed chrome, so chat/workbench content gets the token minimum after toolbar width is paid. |
| Remaining content minimum | `services/pane.ts` reads `layoutTokenPx("--ui-chat-min-width")` as the remaining work area minimum. | Keep the token as the content minimum and make fixed chrome explicit in the same pane solver. |
| Pane drag and keyboard | Both call `paneResizeBounds()` / `resolvedPaneWidths()`. | Fix the solver once so pointer drag, keyboard resize, persisted restore, and window resize share the same legality math. |
| Browser test | `left-pane-resizer-browser.test.ts` currently computes max as `panelWidth - resizer - chatMin`. | Update it to include both activity toolbars and assert chat width is still at least the token at max sidebar width. |

### Root Cause

`sidebarWidth` is the width of `#sidebar`, not the whole left activity shell.
The previous max calculation subtracted only the pane resizer and
`--ui-chat-min-width` from `#panelBody`. It forgot the fixed left activity
toolbar and the fixed right activity toolbar. At the separator `End` position,
the rendered workspace could therefore be short by those toolbar widths even
though ARIA claimed the pane was legal.

### Fix Plan

1. Extend `PaneConfig` with left fixed chrome ids, remaining fixed chrome ids,
   and one content-minimum resolver.
2. Keep `--ui-chat-min-width` as the remaining content minimum source.
3. In `resolvedPaneWidths()`, subtract rendered left fixed chrome before
   computing sidebar max, and add rendered remaining fixed chrome to the
   remaining minimum.
4. Re-render pane layout from the existing scheduled owner; do not add another
   ARIA writer or resize listener.
5. Extend static and browser tests for the fixed chrome reserve.
6. Run focused tests, browser visual QA, typecheck, self-review, commit, and
   push.

### Acceptance

- Dragging the left pane to its maximum cannot leave `#chatSection` narrower
  than `--ui-chat-min-width` because left and right fixed toolbars are now
  accounted for.
- Pane resize math remains in `services/pane.ts`; `main.tsx` still only
  schedules that owner.
- Center panel minimums and overlay aspect-ratio handling remain token-owned
  and unchanged.
- No fallback width, hidden alternate layout, duplicate pane writer, or new
  resize gate is introduced.

### Verification

- PASS: `bun test packages/overlay/test/pane-config.test.ts packages/overlay/test/overlay-window-size-contract.test.ts --timeout 30000`.
- PASS: `bun run --cwd packages/overlay typecheck`.
- PASS: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/left-pane-resizer-browser.test.ts`.
- Visual QA reviewed:
  `.scratch/left-pane-resizer-accessibility.png`,
  `.scratch/left-pane-resizer-desktop-resize.png`,
  `.scratch/left-pane-resizer-illegal-narrow-legal-frame.png`, and
  `.scratch/left-pane-resizer-restored-desktop-resize.png`.

### Self Review

- Rechecked `services/pane.ts`: `sidebarWidth` remains the sidebar width, while
  fixed left and right activity toolbar chrome are now explicit inputs to the
  same pane solver.
- Rechecked the browser assertion: separator `End` now proves the rendered
  `#chatSection` remains at or above `--ui-chat-min-width`.
- Rechecked architecture boundaries: `main.tsx` did not gain a duplicate pane
  writer, center workbench panel minimums still use
  `--ui-workbench-panel-min-width`, and overlay aspect-ratio handling remains
  unchanged.

## Follow-up 2026-06-23: Pane Pointerdown Frame Owner

### Recall

| Source | Constraint carried forward |
| --- | --- |
| Sartre read-only audit | Pointerdown still calls `resizePane()` synchronously, and the browser probe resets immediately after pointerdown, masking drag-start work. |
| `2026-06-22-window-resize-center-layout-frame.md` | Resize work must avoid read/write chains in the same event or RAF phase. |
| `2026-06-23-center-workbench-frame-phase-split.md` | Toolbar and resize work must stay frame-split; no new synchronous geometry owner. |
| This spec | Pane legal max must still reserve left/right activity toolbar chrome and the chat minimum. |

### Call Point Inventory

| Surface | Evidence | Decision |
| --- | --- | --- |
| `startPaneResize()` | Calls `paneHandleEnabled()`, then `resizePane(event.clientX, callbacks, config)` in the pointerdown event. | Avoid pointerdown geometry reads and schedule the initial pointer position through the existing pane RAF scheduler. |
| `onPaneResizeMove()` | Already records `pendingClientX` and uses `paneDrag.resizeOnFrame.schedule()`. | Reuse this as the single drag geometry owner for pointerdown and pointermove. |
| `paneResizeBounds()` | Owns panel body, handle, and fixed toolbar measurements. | Keep unchanged, but run from the scheduled resize frame. |
| Browser probe | Counts only `panelBody` and `leftPaneResizer`, then resets after pointerdown. | Count both activity toolbars and assert pointerdown produces no pre-RAF geometry read or sidebar-width style write. |

### Fix Plan

1. Change pointerdown startup to check only state collapse and handle existence.
2. Route the initial pointer position through `onPaneResizeMove(event)` instead
   of calling `resizePane()` directly.
3. Extend the left-pane browser probe so pointerdown work is measured instead
   of reset away, and fixed toolbar rect reads are included.
4. Keep pointerup flush semantics unchanged so the final persisted width still
   lands before persistence.

### Acceptance

- Pointerdown does not read pane geometry or write `--ui-sidebar-width` before
  the first RAF.
- Pointermove bursts remain coalesced into one scheduled pane resize frame.
- Pane legal bounds still reserve left and right activity toolbar chrome.
- No duplicate pane writer, fallback width, alternate resize gate, or new
  listener path is introduced.

### Implementation

- `startPaneResize()` now checks only collapsed state and handle existence
  before starting a drag.
- The initial pointer position is queued through `onPaneResizeMove(event)`, so
  the first bounds calculation runs in the existing pane resize RAF scheduler.
- The browser probe now counts `panelBody`, `leftPaneResizer`,
  `solidLeftActivityToolbar`, and `solidRightActivityToolbar`, and asserts the
  pointerdown event itself has no pre-RAF geometry reads, sidebar-width writes,
  or ARIA writes.

### Verification

| Check | Result |
| --- | --- |
| `bun test packages/overlay/test/pane-config.test.ts packages/overlay/test/overlay-window-size-contract.test.ts --timeout 30000` | 15 pass |
| `bun run --cwd packages/overlay typecheck` | Pass |
| `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/left-pane-resizer-browser.test.ts` | 1 pass |
| Visual QA | Reviewed `.scratch/left-pane-resizer-accessibility.png`, `.scratch/left-pane-resizer-desktop-resize.png`, `.scratch/left-pane-resizer-illegal-narrow-legal-frame.png`, and `.scratch/left-pane-resizer-restored-desktop-resize.png`. |

### Self Review

- Pointermove and pointerdown now share the existing pane resize scheduler;
  there is still one drag geometry owner.
- Pointerup flush remains synchronous so persistence still records the final
  rendered width before the drag is cleared.
- Pane legal bound math, toolbar chrome reserve, keyboard resize, and scheduled
  ARIA semantics are unchanged.

## Follow-up 2026-06-23: Center Workbench Range Source

### Recall

| Source | Constraint carried forward |
| --- | --- |
| Independent explorer audit 2026-06-23 | `centerWorkbenchResizeRange()` already rejects impossible adjacent widths, but callers still rederive `maxWidth` from `totalWidth - minWidth`. |
| `2026-06-22-center-workbench-panel-min-size-contract.md` | Open panels must keep the token-owned minimum and scroll rather than compress. |
| `2026-06-23-center-workbench-frame-phase-split.md` | Center workbench layout timing stays frame-split; do not add synchronous geometry work. |

### Call Point Inventory

| Surface | Evidence | Decision |
| --- | --- | --- |
| Range helper | `center-workbench-size.ts` returns `{ minWidth, maxWidth }` from `centerWorkbenchResizeRange()`. | Keep this as the single legal range source. |
| Separator ARIA | `main.tsx` writes `aria-valuemax` from `metrics.totalWidth - metrics.minWidth`. | Use `metrics.range.maxWidth` instead. |
| Keyboard End | `resizeCenterWorkbenchPanelByKeyboard()` uses `metrics.totalWidth - metrics.minWidth`. | Use `metrics.range.maxWidth` instead. |
| Drag clamp | `updateCenterWorkbenchPanelWeights()` calls `clampCenterWorkbenchResizeWidth(totalWidth, minWidth, rawLeftWidth)`, which recomputes the range. | Pass the existing range into clamp so impossible ranges cannot be reinterpreted. |
| Tests | `center-workbench-size.test.ts` covers range and clamp; static tests pin current string call sites. | Update tests to guard range-object clamp and reject the retired rederived max strings. |

### Fix Plan

1. Change `clampCenterWorkbenchResizeWidth()` to accept a
   `CenterWorkbenchResizeRange`.
2. Store that range in `CenterWorkbenchPanelResizeMetrics` and
   `CenterWorkbenchPanelResize`.
3. Route separator ARIA, keyboard Home/End, and drag clamp through the stored
   range.
4. Update focused tests and browser center workbench visual coverage.

### Acceptance

- Center workbench resize math has one legal range object per measured adjacent
  pair.
- No caller rederives `maxWidth` as `totalWidth - minWidth`.
- Impossible adjacent panel widths remain disabled rather than clamped to a
  smaller fallback minimum.
- Existing frame-split layout and persisted weight source remain unchanged.

### Verification

- PASS: `bun test packages/overlay/test/center-workbench-size.test.ts packages/overlay/test/pane-config.test.ts packages/overlay/test/resize-observer-frame-scheduler.test.ts --timeout 30000`.
- PASS: `bun run --cwd packages/overlay typecheck`.
- PASS: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/center-workbench-separator-browser.test.ts`.
- Visual QA reviewed:
  `.scratch/center-workbench-three-panel-min-width.png`,
  `.scratch/center-workbench-three-panel-min-width-1120.png`,
  `.scratch/center-workbench-separator-restored-desktop-resize.png`, and
  `.scratch/center-workbench-illegal-tall-aspect-frame.png`.

### Self Review

- Rechecked `main.tsx`: `centerWorkbenchPanelResizeMetrics()` computes the
  legal range once and all separator ARIA, keyboard, and pointer resize paths
  consume `metrics.range`.
- Rechecked `center-workbench-size.ts`: clamp no longer recomputes the range
  from `totalWidth/minWidth`; invalid range objects throw instead of silently
  falling back to a smaller value.
- Rechecked timing boundaries: this change only changes math inputs and does
  not add a resize listener, synchronous reveal, or duplicate persisted width
  source.

## Follow-up 2026-06-23: Layout Token Container Signature

### Recall

| Source | Constraint carried forward |
| --- | --- |
| Independent explorer audit 2026-06-23 | `layoutTokenPx()` cache invalidates only on `--ui-scale`, while `--ui-rail-width` depends on `22cqw`. |
| `2026-06-22-overlay-viewport-size-contract.md` | Pane and center workbench dimensions must resolve from CSS layout tokens, not hardcoded JS constants. |
| `2026-06-23-overlay-compact-legal-frame-query.md` | Descendant width clamps intentionally use `cqw` so they follow the legal overlay container instead of raw viewport width. |
| `2026-06-23-pane-chrome-reserve` | Default rail width feeds the left pane solver and must stay current after legal window resize. |

### Call Point Inventory

| Surface | Evidence | Decision |
| --- | --- | --- |
| Token resolver | `layout-tokens.ts#tokenSignature()` returns only `--ui-scale`. | Include the overlay container inline size in the cache signature. |
| Cqw token | `--ui-rail-width: clamp(..., 22cqw, ...)` is consumed by `defaultRailWidth()`. | Keep this token as the single default rail source; do not mirror the clamp in JS. |
| Fixed-min tokens | `--ui-rail-min-width`, `--ui-chat-min-width`, and `--ui-workbench-panel-min-width` depend on scale only today. | They may invalidate more often, but still resolve through the same helper. |
| Resize path | Window resize schedules pane layout through RAF. | No new listener is needed; the existing layout pass re-reads tokens with the corrected signature. |

### Fix Plan

1. Extend `layoutTokenPx()` cache signature from scale-only to
   scale-plus-container-inline-size.
2. Use the body legal layout width because `body` is the `overlay-shell`
   container and can be wider than `window.innerWidth` in illegal narrow browser
   fixtures.
3. Add static contract tests for the resolver so the cache cannot regress to
   scale-only or raw viewport width.
4. Run focused tests, typecheck, browser resize visual coverage, self-review,
   commit, and push.

### Acceptance

- `layoutTokenPx("--ui-rail-width")` cannot reuse a cached value after the
  overlay shell width changes.
- The resolver still reads CSS tokens rather than duplicating token math in JS.
- No additional resize listener, debounce, fallback token, or parallel default
  rail source is introduced.

### Verification

- PASS: `bun test packages/overlay/test/overlay-window-size-contract.test.ts packages/overlay/test/pane-config.test.ts --timeout 30000`.
- PASS: `bun run --cwd packages/overlay typecheck`.
- PASS: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/left-pane-resizer-browser.test.ts`.
- Visual QA reviewed:
  `.scratch/left-pane-resizer-desktop-resize.png`,
  `.scratch/left-pane-resizer-restored-desktop-resize.png`, and
  `.scratch/left-pane-resizer-illegal-narrow-legal-frame.png`.

### Self Review

- Rechecked `layout-tokens.ts`: the cache key now includes `--ui-scale` and
  the body overlay-shell width, so `cqw` tokens invalidate when the legal
  container width changes.
- Rechecked source ownership: `defaultRailWidth()` still reads
  `--ui-rail-width`; no JS copy of the CSS clamp was introduced.
- Rechecked resize ownership: existing window resize RAF scheduling remains the
  only path that re-renders pane layout after viewport changes.

## Follow-up 2026-06-23: Legal Shell Height and Pane Bounds Budget

### Recall

| Source | Constraint carried forward |
| --- | --- |
| Lovelace read-only audit | Runtime child surfaces still use raw `vh` / `window.innerHeight`, and pane bounds repeatedly re-read the same fixed chrome widths inside one RAF. |
| `2026-06-22-overlay-viewport-size-contract.md` | The body shell is the browser-side mirror of the native `1120x720` minimum and aspect frame. |
| `2026-06-23-overlay-compact-legal-frame-query.md` | Descendant width clamps already read the legal shell instead of raw viewport width. Height must follow the same owner. |
| `2026-06-22-pane-semantics-layout-frame.md` | Pane layout stays owned by `services/pane.ts`; frame-split semantics must not add another geometry writer. |

### Call Point Inventory

| Surface | Evidence | Decision |
| --- | --- | --- |
| Legal shell height | `base.css` directly computes body height from `100vh` and aspect tokens. | Add `--ui-overlay-shell-height` in `base.css` as the only raw viewport-height owner and make `body` consume it. |
| Floating child surfaces | `dialog.css`, `cmdk.css`, `titlebar.css`, `settings.css`, `messages.css`, `workspace.css`, `field.css`, `changes.css`, `composer.css`, and `conversation.css` still use raw `vh`. | Replace child-surface `vh` with `var(--ui-overlay-shell-height)` arithmetic. |
| Dialog drag clamp | `Dialog.tsx` clamps against `window.innerWidth/innerHeight`. | Clamp against `document.body.getBoundingClientRect()`, the legal shell. |
| Pane bounds | `paneResizeBounds()` loops through `paneResolvedSidebarWidth()`, which re-reads panel body, handle, and fixed toolbar widths. | Compute one DOM measurement snapshot and derive `{ min, max, now }` from that snapshot. |
| Static tests | `overlay-window-size-contract.test.ts` already rejects descendant raw `vw`. | Add the matching descendant raw `vh` guard and Dialog legal-shell clamp guard. |
| Browser tests | Existing left-pane and titlebar/dialog image-preview tests produce screenshots. | Re-run focused browser visual tests and inspect screenshots. |

### Root Cause

The legal frame had been applied to width-triggered responsive behavior, but
height-bound child surfaces still used the raw browser viewport. In illegal
tall fixtures, body remains the legal aspect frame while fixed dialogs and
menus can size or clamp against the taller raw viewport. Pane bounds had a
separate performance issue: max-width solving re-entered the same DOM width
reader several times in one scheduled frame even though the max value is a
closed-form expression once fixed chrome widths are known.

### Fix Plan

1. Add `--ui-overlay-shell-height` to `base.css` and use it for body height.
2. Replace production child-surface `vh` height clamps with shell-height
   arithmetic; keep development error overlay CSS out of this runtime contract.
3. Change the shared Dialog primitive's drag clamp to use the legal shell rect.
4. Refactor pane bounds to read panel body, handle, fixed left chrome, fixed
   remaining chrome, and remaining minimum once per frame.
5. Extend static tests for child-surface raw `vh`, Dialog clamp, and pane bounds
   read budget.
6. Run focused tests, overlay typecheck, browser visual QA, self-review,
   commit, and push.

### Acceptance

- Production overlay child surfaces do not use raw `vh`; `base.css` is the only
  raw viewport-height owner for the legal shell.
- Dialog drag bounds use the legal shell rect, not raw `window.innerHeight`.
- Pane resize bounds have one geometry snapshot and no fixed-point loop.
- No fallback height, duplicate size constant, resize gate, or second pane
  writer is introduced.

### Implementation

- `base.css` now defines `--ui-overlay-shell-height` from the existing legal
  aspect-frame expression and uses that variable for `body` height.
- Runtime surface CSS now uses `--ui-overlay-shell-height` for dialog, command
  palette, titlebar menu, settings, message preview, field, composer,
  conversation, changes, and compact workspace height clamps.
- The shared Dialog primitive clamps dragging against
  `document.body.getBoundingClientRect()` instead of raw window dimensions.
- `services/pane.ts` now reads one `PaneGeometrySnapshot` per pane bounds pass
  and computes sidebar max from that snapshot without the old fixed-point loop.
- High-confidence dead CSS from the retired Markdown class renderer was
  removed, and the Files heading icon selector now uses an explicit
  `file-changes-view__heading-icon` class instead of the non-existent `.oc-icon`
  convention.

### Verification

- PASS: `bun test packages/overlay/test/overlay-window-size-contract.test.ts packages/overlay/test/pane-config.test.ts packages/overlay/test/message-image-preview.test.ts packages/overlay/test/browser-preview-panel.test.ts packages/overlay/test/overlay-architecture-guards.test.ts packages/overlay/test/markdown-safety.test.ts packages/overlay/test/agent-file-changes.test.ts packages/overlay/test/css-structural-validity.test.ts --timeout 30000`.
- PASS: `bun run --cwd packages/overlay typecheck`.
- PASS after one implementation correction: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/titlebar-menubar.test.ts`.
- PASS cumulative browser coverage before that correction except for the
  corrected titlebar click path: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/left-pane-resizer-browser.test.ts packages/overlay/test/browser/titlebar-menubar.test.ts packages/overlay/test/browser/command-palette.test.ts packages/overlay/test/browser/image-preview-accessible-name.test.ts packages/overlay/test/browser/image-preview-copy.test.ts packages/overlay/test/browser/markdown-syntax-contrast-browser.test.ts packages/overlay/test/browser/toolbar-diff-navigation.test.ts`.
- Visual QA reviewed:
  `.scratch/left-pane-resizer-illegal-narrow-legal-frame.png`,
  `.scratch/titlebar-run-checkbox-menuitem-focus.png`,
  `.scratch/titlebar-view-radio-focus.png`,
  `.scratch/command-palette-dialog-primitive.png`,
  `.scratch/image-preview-mounted-markdown-dialog.png`,
  `.scratch/markdown-syntax-contrast-light.png`,
  `.scratch/file-changes-light-contrast.png`, and
  `.scratch/file-changes-keyboard-row-focus.png`.

### Self Review

- Rechecked raw viewport-height usage: production surface CSS no longer has raw
  `vh`; only `base.css` owns the raw viewport height for legal shell
  construction.
- Rechecked Dialog: an intermediate `width: 100cqw` change made the titlebar log
  dialog close button unclickable in an illegal narrow browser fixture, so the
  final implementation keeps dialog width viewport-clickable and only moves
  height and drag bounds to the legal shell.
- Rechecked pane bounds: pointer, keyboard, and ARIA paths still share the
  pane service owner, but max width no longer re-enters DOM geometry reads in a
  fixed-point loop.
- Rechecked dead CSS: Markdown retired class selectors and the `.oc-icon`
  heading selector now have negative tests so they cannot silently return.

## Follow-up 2026-06-23: CSS Shell Height Minimum Floor

### Recall

| Source | Constraint carried forward |
| --- | --- |
| User feedback 2026-06-23 | Illegal aspect ratios and too-small panels are not acceptable; the legal minimum panel frame must be enforced at runtime. |
| Euclid read-only audit | CSS `--ui-overlay-shell-height` still computes from raw `100vw` before the native minimum width floor, so descendants can see a smaller height than the body legal frame. |
| `overlay-layout-frame.ts` | The JS legal frame computes `width = max(viewport.width, minimum.width)` and `height = max(minimum.height, min(viewport.height, width / aspect))`. |
| `2026-06-23-overlay-legal-shell-height` | `base.css` is the only raw viewport-height owner; child surfaces must consume the shell token instead of raw `vh`. |

### Call Point Inventory

| Surface | Evidence | Decision |
| --- | --- | --- |
| CSS shell height owner | `base.css` defines `--ui-overlay-shell-height: min(100vh, calc(100vw * min-height / min-width))`. | Add a shell inline-size token with the same native minimum width floor before deriving shell height. |
| JS legal frame | `constrainOverlayLayoutFrame()` already applies the minimum width before deriving height. | Keep unchanged and mirror its formula in CSS. |
| Child surface clamps | Dialog, cmdk, workspace, settings, messages, changes, field, composer, conversation, and titlebar consume `--ui-overlay-shell-height`. | Fix the token value once; do not add per-surface height exceptions. |
| Browser legal-frame tests | `side-activity-toolbar-browser.test.ts` already probes illegal narrow viewports. | Add a probe proving the resolved shell-height token equals body height and remains at least the overlay minimum. |
| Static contract tests | `overlay-window-size-contract.test.ts` currently checks for raw formula fragments. | Update it to require the minimum-floor shell-width/height formula. |

### Root Cause

The body itself has `min-width` and `min-height`, but the custom property that
descendant panels consume was computed from raw `100vw`. In illegal narrow or
tall browser fixtures, descendants could therefore size compact panels from a
height smaller than the legal body frame. This is a contract split between the
CSS shell token and `overlay-layout-frame.ts`.

### Fix Plan

1. Add `--ui-overlay-shell-width: max(100vw, var(--ui-overlay-min-width))` to
   the body shell owner.
2. Define `--ui-overlay-shell-height` as the JS legal-frame mirror:
   `max(min-height, min(100vh, shell-width / min-aspect))`.
3. Update static guards to require this formula and keep raw `vh`/`vw` ownership
   in `base.css` only.
4. Extend browser legal-frame coverage for illegal narrow viewports so the
   resolved shell-height token equals the rendered body height.
5. Run focused tests, visual QA, self-review, commit, and push.

### Acceptance

- Descendant panels consuming `--ui-overlay-shell-height` cannot see a height
  below the legal overlay minimum frame.
- CSS and JS legal frame formulas share the same minimum width floor and aspect
  derivation.
- No fallback height, duplicate panel-size source, compact-layout gate, or
  per-surface exception is introduced.

### Implementation

- `base.css` now defines `--ui-overlay-shell-width` as
  `max(100vw, var(--ui-overlay-min-width))`.
- `--ui-overlay-shell-height` now mirrors `constrainOverlayLayoutFrame()`:
  minimum height floor first, then raw viewport height capped by legal shell
  width divided by the minimum aspect ratio.
- `overlay-window-size-contract.test.ts` now rejects the old raw-`100vw`
  height derivation.
- `side-activity-toolbar-browser.test.ts` now resolves the shell-height token
  in illegal narrow viewport fixtures and asserts it equals the rendered body
  height while staying above the overlay minimum height.

### Verification

- PASS: `bun test packages/overlay/test/overlay-window-size-contract.test.ts packages/overlay/test/overlay-layout-frame.test.ts packages/overlay/test/workspace-surface-consistency.test.ts --timeout 30000`.
- PASS: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/side-activity-toolbar-browser.test.ts`.
- PASS: `bun run --cwd packages/overlay typecheck`.
- PASS: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/center-workbench-separator-browser.test.ts`.
- Visual QA reviewed:
  `.scratch/side-activity-toolbar-illegal-narrow-legal-frame.png`,
  `.scratch/center-workbench-three-panel-min-width-1120.png`, and
  `.scratch/center-workbench-illegal-tall-aspect-frame.png`.

### Self Review

- Rechecked shell ownership: raw `100vh`/`100vw` remain in `base.css`, the
  existing legal shell owner, and child surfaces still consume the same shell
  token rather than a second height source.
- Rechecked formula parity: CSS now applies the native minimum width before
  deriving height, matching `constrainOverlayLayoutFrame()`.
- Rechecked browser evidence: illegal narrow viewports keep the right toolbar
  vertical inside the legal 1120px canvas, and illegal tall viewports keep the
  overlay content aspect-clamped instead of expanding child panels to the raw
  viewport height.

## Follow-up 2026-06-23: Screenshot Panel ResizeObserver Width Source

### Recall

| Source | Constraint carried forward |
| --- | --- |
| User report | Opening toolbar screenshots is visibly slow; screenshot panel resize work is on the direct complaint path. |
| Euclid read-only audit | `ScreenshotBrowserPanel` still does `ResizeObserver -> RAF -> element.clientWidth -> setListWidth`, creating a width read/write loop during toolbar open and container resize. |
| `screenshot-browser-panel-browser.test.ts` | Existing browser coverage instruments screenshot panel open, RAF timing, thumbnail virtualization, and narrow-panel visual layout. |
| `ScreenshotBrowserPanel.tsx` call inventory | `listWidth` only feeds `columnCount()`, which feeds row chunking and grid column count. |

### Call Point Inventory

| Surface | Evidence | Decision |
| --- | --- | --- |
| Resize observer callback | `ScreenshotBrowserPanel.tsx` constructs `new ResizeObserver(measureOnFrame.schedule)`. | Replace it with an entry-aware callback that stores `entry.contentRect.width`. |
| RAF commit | Current `measure()` reads `element.clientWidth` inside the scheduled RAF. | RAF should commit the pending observer width only; no DOM width read. |
| Initial width | Current code schedules an initial RAF read. | Let the observed element's first ResizeObserver delivery be the width source; no second initial source. |
| Static test | `screenshot-browser-panel.test.ts` currently requires `clientWidth` measurement. | Flip the guard to require `contentRect.width` and reject `element.clientWidth`. |
| Browser test | Existing instrumentation records `.screenshot-browser-groups` `clientWidth` reads. | Assert screenshot open produces no screenshot-list `clientWidth` read while cards still render and visual screenshots stay valid. |

### Root Cause

The screenshot panel already subscribes to ResizeObserver, but then discards
the entry's measured width and re-reads layout in the next RAF. On toolbar open
and viewport resize this adds an avoidable synchronous geometry dependency to
the same surface that is recomputing virtual rows.

### Fix Plan

1. Store the observed `.screenshot-browser-groups` width from
   `ResizeObserverEntry.contentRect.width`.
2. Let the existing RAF scheduler coalesce width commits from observer
   deliveries.
3. Remove the initial RAF `clientWidth` read; the observer delivery is the
   single width source.
4. Update static and browser tests to reject screenshot-list `clientWidth`
   reads during open while preserving virtualization and visual layout checks.
5. Run focused tests, browser visual QA, self-review, commit, and push.

### Acceptance

- Screenshot panel width updates consume ResizeObserver entries instead of
  reading `.clientWidth` in RAF.
- Toolbar screenshot open still renders cards, lazy thumbnails, and narrow
  visual layout.
- No fallback width, duplicate measurement source, or active-state gate is
  introduced.

### Implementation

- `ScreenshotBrowserPanel.tsx` now stores width from the matching
  `ResizeObserverEntry.contentRect.width`.
- The existing animation-frame scheduler now only coalesces `setListWidth()`
  commits; it no longer performs a DOM width read.
- The initial scheduled `clientWidth` read was removed so ResizeObserver is the
  only screenshot-list width source.
- Static and browser tests now reject screenshot-list `clientWidth` reads while
  keeping card rendering, lazy thumbnail decode, and narrow visual layout
  assertions.

### Verification

- PASS: `bun test packages/overlay/test/screenshot-browser-panel.test.ts --timeout 30000`.
- PASS: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/screenshot-browser-panel-browser.test.ts`.
- PASS: `bun run --cwd packages/overlay typecheck`.
- Visual QA reviewed:
  `.scratch/screenshot-browser-panel-browser.png` and
  `.scratch/screenshot-browser-panel-browser-narrow-panel.png`.

### Self Review

- Rechecked width ownership: `listWidth` is still the single width signal for
  column count, but its source is now the observer entry rather than a second
  DOM read.
- Rechecked activation semantics: no active-state gate or fallback width was
  introduced; inactive behavior still comes from the existing `items()` memo.
- Rechecked visual output: grouped screenshots, thumbnail images, and the
  narrow minimum panel layout still render without card or thumbnail overflow.

## Follow-up 2026-06-23: Center Workbench Separator Geometry Snapshot

### Recall

| Source | Constraint carried forward |
| --- | --- |
| User report | Toolbar panel opening is slow, especially screenshots and preview panels. |
| Euclid read-only audit | Center workbench opening reads adjacent panel rects per separator and repeats reads for middle panels in the same measurement frame. |
| `2026-06-23-center-workbench-frame-phase-split.md` | Layout writes and measurement/reveal remain split across animation frames. |
| Current browser probe | `center-workbench-separator-browser.test.ts` already verifies resize reads are in RAF and not in style-write frames. |

### Call Point Inventory

| Surface | Evidence | Decision |
| --- | --- | --- |
| Separator render | `renderCenterWorkbenchPanelSeparators()` calls `centerWorkbenchPanelResizeMetrics()` for every separator. | Read one open-panel geometry snapshot before the separator loop. |
| Metrics helper | `centerWorkbenchPanelResizeMetrics()` reads left and right `getBoundingClientRect()` itself. | Accept a snapshot argument and consume pre-read rects. |
| Drag/keyboard resize | Pointer start and keyboard resize also call `centerWorkbenchPanelResizeMetrics()`. | Keep them on the same helper; the default snapshot reads current open panels once for that call. |
| Reveal ordering | `renderCenterWorkbenchPanelMeasurementsAndReveal()` runs separators then reveal. | Keep frame split and existing reveal ordering unchanged in this round. |
| Tests | Static frame-scheduler and browser center-workbench tests cover the function boundary. | Add static guard for snapshot ownership and keep browser visual coverage. |

### Root Cause

The measurement frame already separated style writes from geometry reads, but
the geometry read phase still re-entered DOM layout once per adjacent pair.
With multiple center panels open, a middle panel participates in two separators
and is measured twice in the same frame.

### Fix Plan

1. Add a center workbench geometry snapshot containing the current view map and
   one rect per open panel.
2. Pass the snapshot into separator metrics so each open panel is measured once
   per measurement frame.
3. Keep drag and keyboard callers on the same metrics helper without adding a
   second resize source.
4. Extend static guards and rerun center-workbench browser visual coverage.

### Acceptance

- Separator rendering reads open panel geometry from one snapshot per frame.
- Middle panels are not re-measured once per adjacent separator.
- Frame split remains intact: layout writes schedule measurement on the next
  RAF, and no fallback range or duplicate separator owner is introduced.

### Implementation

- Added `readCenterWorkbenchPanelGeometrySnapshot()` so a measurement frame
  reads each open center panel rect once.
- `centerWorkbenchPanelResizeMetrics()` now consumes that snapshot and no
  longer reads left/right rects independently per separator.
- `renderCenterWorkbenchPanelSeparators()` creates one snapshot before its
  separator loop and passes it into each metrics call.
- Drag start and keyboard resizing remain on the same metrics helper, keeping
  one range and resize owner.

### Verification

- PASS: `bun test packages/overlay/test/resize-observer-frame-scheduler.test.ts packages/overlay/test/center-workbench-size.test.ts packages/overlay/test/screenshot-browser-panel.test.ts --timeout 30000`.
- PASS: `bun run --cwd packages/overlay typecheck`.
- PASS: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/center-workbench-separator-browser.test.ts`.
- Visual QA reviewed:
  `.scratch/center-workbench-three-panel-min-width-1120.png`.

### Self Review

- Rechecked measurement ownership: the separator render frame now has one
  explicit geometry snapshot, not a hidden per-separator DOM read loop.
- Rechecked drag and keyboard paths: they still call
  `centerWorkbenchPanelResizeMetrics()` and consume the same legal range helper.
- Rechecked frame split: layout writes still schedule measurements on the next
  animation frame, and reveal ordering remains unchanged.

## Follow-up 2026-06-23: Center Workbench Reveal Frame Split

### Recall

| Source | Constraint carried forward |
| --- | --- |
| User feedback 2026-06-23 | Illegal aspect ratios and too-small panels are not acceptable; opening toolbar panels must not create resize jank. |
| `2026-06-23-center-workbench-frame-phase-split.md` | DOM state writes, layout measurements, and layout-affecting follow-up work must stay in explicit frame phases. |
| This spec, previous follow-up | Separator geometry now reads from one snapshot per measurement frame. |
| Current live 7878 probe | The running 7878 tab appears stale and still shows the old illegal 900x900 bottom-toolbar layout without shell width/height CSS variables; do not refresh/restart it without explicit user approval. |

### Call Point Inventory

| Surface | Evidence | Decision |
| --- | --- | --- |
| `revealPendingCenterWorkbenchPanel()` | Owns the only center workbench `scrollIntoView()` call in `main.tsx`. | Keep it as the single reveal owner. |
| `renderCenterWorkbenchPanelMeasurementsAndReveal()` | Calls `renderCenterWorkbenchPanelSeparators()` and then `revealPendingCenterWorkbenchPanel()` in the same RAF. | Remove the scroll side effect from the measurement RAF. |
| `renderCenterWorkbenchPanelMeasurementsOnFrame` | Schedules the separator measurement phase after layout writes. | Keep this scheduler as the measurement owner. |
| `scheduleCenterWorkbenchPanelReveal()` | Sets `pendingCenterWorkbenchRevealPanel` and schedules layout. | Keep the public scheduling entry unchanged. |
| Cleanup disposer | Cancels layout and measurement schedulers. | Add reveal scheduler cancellation in the same cleanup block. |
| Browser instrumentation | `screenshot-browser-panel-browser.test.ts` records `scrollIntoView` and RAF context but not frame ordering against rect reads. | Extend instrumentation so reveal scroll is proven to be in a later frame than measurement reads. |

### Root Cause

The previous round made separator measurement cheaper by snapshotting geometry,
but the measurement RAF still performs `scrollIntoView()` immediately after DOM
rect reads. `scrollIntoView()` is layout-affecting follow-up work, not a pure
measurement. Keeping it in the same callback can force extra layout work during
toolbar panel open and window resize.

### Fix Plan

1. Add a dedicated `revealPendingCenterWorkbenchPanelOnFrame` scheduler that
   runs `revealPendingCenterWorkbenchPanel`.
2. Make the measurement callback only render separator semantics and schedule
   the reveal scheduler.
3. Cancel the reveal scheduler during cleanup and keep pending reveal reset in
   the same block.
4. Update static tests to require the dedicated reveal scheduler and reject
   direct reveal calls from the measurement function.
5. Extend browser open instrumentation to assert reveal scroll happens in a RAF
   after the center workbench rect-read frame.

### Acceptance

- Center workbench separator measurement remains the only work in the
  measurement RAF.
- Center workbench reveal scroll is still the single reveal owner, but runs in
  its own scheduled frame.
- No fallback/gate/second size source is introduced.
- Latest-build browser tests still show legal right-toolbar layout and usable
  screenshot panel under illegal viewport fixtures.

### Implementation

- Added `revealPendingCenterWorkbenchPanelOnFrame` as the dedicated reveal
  scheduler in `main.tsx`.
- Changed `renderCenterWorkbenchPanelMeasurementsAndReveal()` so the
  measurement RAF renders separator semantics, then schedules reveal work
  instead of calling `scrollIntoView()` directly.
- Added cleanup cancellation for the reveal scheduler.
- Updated static frame-scheduler tests to require the dedicated reveal
  scheduler and reject a direct reveal call inside the measurement function.
- Extended screenshot browser instrumentation to record center workbench rect
  reads and reveal scroll frame IDs, then assert reveal runs in a later RAF than
  the measurement read.

### Verification

- PASS: `bun test packages/overlay/test/resize-observer-frame-scheduler.test.ts --timeout 30000`.
- PASS: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/screenshot-browser-panel-browser.test.ts`.
- PASS: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/center-workbench-separator-browser.test.ts`.
- PASS: `bun run --cwd packages/overlay typecheck`.
- PASS: `bun test packages/overlay/test/acceptance-panel-mount.test.ts packages/overlay/test/browser-preview-panel.test.ts --timeout 30000`.
- Visual QA reviewed:
  `.scratch/screenshot-browser-panel-browser.png`,
  `.scratch/screenshot-browser-panel-browser-reopen.png`,
  `.scratch/live-7878-current-state.png`, and
  `.scratch/live-7878-illegal-900x900.png`.

### Self Review

- Rechecked the center workbench reveal path: there is still only one
  `scrollIntoView()` owner for center panels, but it is no longer executed in
  the same RAF as separator geometry reads.
- Rechecked scheduler cleanup: layout, measurement, reveal, and pending reveal
  state are all disposed from the same owner block.
- Rechecked legal-size behavior in latest-build screenshots: right toolbar stays
  vertical, screenshot thumbnails remain inside the legal panel, and illegal
  narrow viewport fixtures clip the legal shell instead of shrinking panels
  below token minimums.
- Rechecked live 7878 only as stale runtime evidence: it still lacks the latest
  shell CSS variables and shows the old bottom-toolbar behavior at 900x900, so
  it was not used as latest-code acceptance evidence and was not refreshed.

## Follow-up 2026-06-23: Remove Dead Overlay-Shell Compact CSS

### Recall

| Source | Constraint carried forward |
| --- | --- |
| User feedback 2026-06-23 | Aspect ratio and minimum panel width are hard legality constraints; illegal small panels must not be preserved as alternate layouts. |
| Pascal read-only audit | `body` is the only `overlay-shell` container and has `min-width: var(--ui-overlay-min-width)`, so all `@container overlay-shell (width < 1120px)` and smaller branches are unreachable dead CSS. |
| `2026-06-23-overlay-compact-legal-frame-query.md` | Raw viewport compact media queries were replaced with legal-shell queries to stop illegal browser fixtures from activating compact panel layouts. |
| `2026-06-23-css-shell-height-minimum-floor` | The legal shell width/height now mirrors the native minimum frame; descendant layout must not reintroduce compact behavior below that frame. |

### Call Point Inventory

| Surface | Evidence | Decision |
| --- | --- | --- |
| `base.css` | `body` declares `container: overlay-shell / inline-size` and `min-width: var(--ui-overlay-min-width)`. | Keep the legal container owner. |
| `workspace.css` | Contains `@container overlay-shell (width < 1120px)` and `< 520px` compact branches that shrink panels and hide non-selected workbench views. | Delete as unreachable and harmful to the legal panel-width contract. |
| `activity.css` | Contains `@container overlay-shell (width < 1120px)` that turns the right toolbar horizontal. | Delete as the direct stale compact-toolbar branch. |
| `titlebar.css` | Contains `< 760px` and `< 520px` overlay-shell branches for compact titlebar/menu/brand behavior. | Delete; legal shell never reaches these widths. |
| `dialog.css`, `messages.css`, `settings.css`, `workspace-onboarding.css` | Contain smaller overlay-shell branches for local component compaction. | Delete the unreachable overlay-shell owners; component-local behavior must use component containers if later required. |
| `--ui-overlay-min-aspect-ratio` | Defined in tokens and asserted in tests, but not consumed by runtime CSS/TS/Rust. | Remove the duplicate token contract surface. |

### Root Cause

The previous raw viewport compact rules were correctly moved off viewport media
queries, but they were moved to the legal shell container. Because that
container is the `body` and the body is clamped to the native minimum width,
these compact branches can no longer match in valid runtime CSS. Keeping them
creates a dead second layout path that tests accidentally pin and makes illegal
small-panel behavior easier to reintroduce.

### Fix Plan

1. Delete all `@container overlay-shell (width < ...px)` blocks under the
   1120px legal shell minimum.
2. Remove the unused `--ui-overlay-min-aspect-ratio` token and its test
   expectation.
3. Replace existing tests that require narrow overlay-shell branches with guards
   rejecting them.
4. Keep component-local container queries such as `chat-workbench`; only the
   legal shell compact branches are dead.

### Acceptance

- No production CSS contains `@container overlay-shell (width < ...px)`.
- No tests require or pin overlay-shell compact branches.
- Runtime legal shell tokens still derive width/height from the same native
  minimum width/height units.
- Latest-build visual QA still shows legal right toolbar and center workbench
  panels at normal and illegal browser fixture sizes.

### Implementation

- Deleted all production `@container overlay-shell (width < ...px)` branches
  from `activity.css`, `dialog.css`, `messages.css`, `settings.css`,
  `titlebar.css`, `workspace-onboarding.css`, and `workspace.css`.
- Removed the unused `--ui-overlay-min-aspect-ratio` token from
  `design-language.css`.
- Updated static tests so the legal shell compact branches are rejected instead
  of required.
- Kept component-owned container queries, including `chat-workbench`, because
  those containers can still be narrower than the legal overlay shell.

### Verification

- PASS: `bun test packages/overlay/test/overlay-window-size-contract.test.ts packages/overlay/test/overlay-architecture-guards.test.ts packages/overlay/test/workspace-surface-consistency.test.ts packages/overlay/test/provider-settings-layout.test.ts packages/overlay/test/titlebar-brand-guide-primitive.test.ts --timeout 30000`.
- PASS: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/side-activity-toolbar-browser.test.ts`.
- PASS: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/screenshot-browser-panel-browser.test.ts`.
- PASS: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/titlebar-menubar.test.ts`.
- PASS: `bun run --cwd packages/overlay typecheck`.
- Visual QA reviewed:
  `.scratch/side-activity-toolbar-illegal-narrow-legal-frame.png`,
  `.scratch/screenshot-browser-panel-browser.png`,
  `.scratch/screenshot-browser-panel-browser-reopen.png`,
  `.scratch/titlebar-illegal-narrow-legal-frame.png`,
  `.scratch/titlebar-top-level-menus.png`, and
  `.scratch/titlebar-view-range-focus.png`.

### Self Review

- Rechecked production CSS with grep: no `@container overlay-shell (width <`
  branch remains under `packages/overlay/src`.
- Rechecked the aspect ratio source: runtime CSS/TS/Rust continue deriving the
  frame from `--ui-overlay-min-width-units` and
  `--ui-overlay-min-height-units`; the removed aspect token was not consumed.
- Rechecked latest-build browser evidence: illegal narrow fixtures render the
  legal overlay shell instead of compacting the right toolbar or center panels.
- Rechecked scope: this round did not change component-local container queries,
  only unreachable overlay-shell compact branches.

## Follow-up 2026-06-23: Native Aspect Platform Boundary

### Recall

| Source | Constraint carried forward |
| --- | --- |
| Pascal read-only audit | Historical viewport spec said native resize cannot leave the overlay below the aspect contract, but the current pre-commit native hook is Windows-only. |
| `2026-06-22-native-resize-no-set-size-loop.md` | Do not restore `WindowEvent::Resized -> window.set_size(...)`; that feedback loop caused resize jank. |
| `2026-06-22-overlay-layout-aspect-frame.md` | Windows `WM_SIZING` constrains the mutable resize rectangle before OS commit. |
| Local Tauri/tao source | `WindowSizeConstraints` exposes min/max size only; no cross-platform aspect-ratio constraint exists in the public Tauri runtime surface. |

### Call Point Inventory

| Surface | Evidence | Decision |
| --- | --- | --- |
| Windows native resize | `main.rs` installs `install_overlay_resize_aspect_constraint()` under `#[cfg(windows)]`, using `WM_SIZING` and `SetWindowSubclass`. | Keep as the only native pre-commit aspect owner currently implemented. |
| Non-Windows native resize | Tauri/tao exposes resize events and min/max constraints, not a verified aspect-ratio pre-commit API. | Do not add a post-resize correction loop or unverified platform dependency. |
| Browser shell | CSS/TS legal frame clamps illegal browser/dev viewports. | Keep as the cross-platform WebView-side safety net. |
| Historical specs | `2026-06-22-overlay-viewport-size-contract.md` still implied platform-neutral native aspect enforcement. | Correct the wording to Windows native + cross-platform browser shell. |
| Static test | `overlay-window-size-contract.test.ts` checked for the Windows hook but did not state the platform boundary. | Require `#[cfg(windows)]` for the native aspect hook and reject `RunEvent::WindowEvent` feedback. |

### Root Cause

The system has two different guarantees that were conflated in older prose:
Windows native resize is constrained before the OS commits a rectangle, while
browser/dev illegal viewports are clamped by the legal shell. Tauri's public
runtime constraints do not currently provide a cross-platform aspect-ratio
constraint, so adding non-Windows `WindowEvent::Resized -> set_size()` logic
would reintroduce the exact live resize feedback loop the project retired.

### Fix Plan

1. Correct historical spec wording so it no longer claims platform-neutral
   native aspect-ratio enforcement.
2. Add static coverage that the native aspect hook remains explicitly
   Windows-gated and that the event-loop resize feedback path is absent.
3. Keep this as a contract correction unless a verified macOS/Linux pre-commit
   native aspect API is added and tested on those platforms.

### Acceptance

- Specs distinguish Windows native pre-commit aspect enforcement from the
  cross-platform browser legal shell.
- Static tests reject reintroducing `RunEvent::WindowEvent` / `WindowEvent::Resized`
  resize correction paths.
- No unverified macOS/Linux native dependency or fallback resize loop is added.

### Implementation

- Corrected `2026-06-22-overlay-viewport-size-contract.md` so native aspect
  enforcement is described as Windows pre-commit `WM_SIZING`, with non-Windows
  covered by the browser legal shell unless a verified native pre-commit API is
  added later.
- Corrected `2026-06-22-overlay-layout-aspect-frame.md` so its source ownership
  language no longer implies a deleted standalone aspect token or
  platform-neutral native aspect hook.
- Updated `overlay-window-size-contract.test.ts` to require `#[cfg(windows)]`
  on the native aspect hook and to reject `RunEvent::WindowEvent` feedback.

### Verification

- PASS: `bun test packages/overlay/test/overlay-window-size-contract.test.ts --timeout 30000`.
- PASS after correcting the command filter: `cargo test --manifest-path packages/overlay/src-tauri/Cargo.toml overlay_ -- --nocapture`.

### Self Review

- Rechecked local Tauri/tao sources: `WindowSizeConstraints` exposes min/max
  dimensions, not a cross-platform aspect-ratio constraint.
- Rechecked the Windows path: `WM_SIZING` still constrains before OS commit, and
  the static test now proves that path remains Windows-gated.
- Rechecked the forbidden path: no `RunEvent::WindowEvent` or
  `tauri::WindowEvent::Resized` correction path was introduced.
- Rechecked scope: no macOS/Linux dependency, unverified native hook, fallback
  path, or live `set_size()` resize loop was added.

## Follow-up 2026-06-23: Pane Handle Width Single Source

### Recall

| Source | Constraint carried forward |
| --- | --- |
| User feedback 2026-06-23 | Minimum panel width is a legality constraint; illegal sizes must be rejected instead of hidden behind alternate values. |
| `2026-06-22-pane-semantics-layout-frame.md` | `services/pane.ts` owns pane layout and handle semantics; do not add another pane writer. |
| This spec | Pane legal max reserves fixed left and right toolbar chrome from the same solver. |
| Static grep | `paneHandleWidth()` is consumed only by `readPaneGeometrySnapshot()`, which feeds `resolvedPaneWidths()` and `paneResizeBounds()`. |

### Call Point Inventory

| Surface | Evidence | Decision |
| --- | --- | --- |
| Pane resize handle CSS | `.pane-resizer` has `flex: 0 0 var(--ui-resizer-width)` and `min-width: var(--ui-resizer-width)`. | Keep CSS as the only rendered handle width source. |
| Pane service handle measurement | `paneHandleWidth()` read `getBoundingClientRect().width`, then read `--ui-resizer-width` when the rendered width was not positive. | Remove the token fallback; a visible handle that renders at zero width is an invalid layout contract. |
| Pane layout solver | `readPaneGeometrySnapshot()` uses `paneHandleWidth()` for both pane max and ARIA range. | Keep the single solver and let invalid handle geometry fail instead of inventing a second value. |
| Tests | `pane-config.test.ts` already pins pane ownership and geometry inputs. | Extend it to reject the retired token fallback and require the positive rendered-width assertion. |

### Root Cause

`paneHandleWidth()` had two sources for one physical width: the rendered DOM
rectangle and the `--ui-resizer-width` token. The token already owns the CSS
layout, so reading it again after a zero rendered width hides broken pane
geometry and lets resize math proceed with a value the browser did not
actually render.

### Fix Plan

1. Remove the `--ui-resizer-width` runtime fallback from `paneHandleWidth()`.
2. Throw when a visible pane handle renders with a non-positive width.
3. Add static coverage rejecting the fallback string and requiring the
   positive-width assertion.
4. Re-run focused pane tests, overlay typecheck, the real left-pane browser
   test, screenshot review, self-review, commit, and push.

### Acceptance

- Pane resize handle width has one source: the rendered `.pane-resizer` box.
- A visible zero-width handle fails fast instead of continuing with a duplicate
  token value.
- Pane layout and ARIA semantics remain owned by `services/pane.ts`; no second
  writer, fallback width, resize gate, or alternate layout path is introduced.

### Verification

- PASS: `bun test packages/overlay/test/pane-config.test.ts packages/overlay/test/overlay-window-size-contract.test.ts --timeout 30000`.
- PASS: `bun run --cwd packages/overlay typecheck`.
- PASS: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/left-pane-resizer-browser.test.ts`.
- Visual QA reviewed:
  `.scratch/left-pane-resizer-accessibility.png`,
  `.scratch/left-pane-resizer-desktop-resize.png`,
  `.scratch/left-pane-resizer-illegal-narrow-legal-frame.png`, and
  `.scratch/left-pane-resizer-restored-desktop-resize.png`.

### Self Review

- Rechecked `paneHandleWidth()`; it now consumes only the rendered handle
  rectangle and rejects visible zero-width handles.
- Rechecked `pane-config.test.ts`; it rejects reintroducing the
  `--ui-resizer-width` runtime fallback string.
- Rechecked the browser screenshots; legal desktop layout, illegal narrow legal
  frame, and restored desktop resize states keep the left pane, chat area, and
  right toolbar coherent.
- Rechecked scope: no second pane writer, compatibility path, resize gate, or
  alternate layout source was added.

## Follow-up 2026-06-23: Overlay Size and UI Scale Single Source

### Recall

| Source | Constraint carried forward |
| --- | --- |
| Peirce read-only audit | Native `minWidth/minHeight`, WebView overlay tokens, `currentUIScale()` fallback, and stale legal-size prose still left high-confidence double-source/fallback/spec debt. |
| `2026-06-22-overlay-viewport-size-contract.md` | The native overlay minimum is `1120x720`; browser layout must mirror that legal frame. |
| `2026-06-22-overlay-layout-aspect-frame.md` | Do not reintroduce `WindowEvent::Resized -> set_size()` feedback loops. |
| `2026-06-22-center-workbench-panel-min-size-contract.md` | Historical intermediate `@media (width < 1120px)` decision is superseded by the legal shell cleanup. |

### Call Point Inventory

| Surface | Evidence | Decision |
| --- | --- | --- |
| Native author source | `src-tauri/tauri.conf.json` is required by Tauri and already owns the main window `minWidth/minHeight`. | Keep it as the only authored numeric legal frame source. |
| WebView overlay tokens | `design-language.css` separately authored `--ui-overlay-min-width-units: 1120` and `--ui-overlay-min-height-units: 720`. | Delete these authored values and inject generated CSS from the Tauri config during Vite HTML transform. |
| Build/dev entry | `vite.config.ts` already injects overlay version into HTML. | Add a second HTML transform that replaces an explicit marker with generated legal-frame tokens. |
| Unused XL breakpoint | `--ui-breakpoint-xl: 1120px` has no production consumer after legal-shell compact branch deletion. | Delete it to avoid another apparent legal-width source. |
| UI scale helper | `services/pane.ts` exported `currentUIScale()` with `document` and parse fallbacks to `1`; `ChatComposer.tsx` kept a local duplicate. | Move a single fail-fast `currentUIScale()` to `utils/layout-tokens.ts` and update all consumers. |
| Zoom service | `theme.ts` read `--ui-scale` with `"1"` / `|| 1` fallback. | Use the shared fail-fast helper and reject invalid zoom base values. |
| Stale spec | `2026-06-22-center-workbench-panel-min-size-contract.md` still read as an active verified compact-branch plan. | Mark it superseded and add a static guard. |

### Root Cause

The legal shell repair removed runtime compact branches, but the numeric
contract still lived in two files: static Tauri JSON and static CSS tokens.
That made equality a convention instead of a data-flow fact. The same era left
multiple UI scale readers that silently returned `1`, so invalid CSS variables
could drive resize math with an invented scale instead of exposing the broken
token source.

### Fix Plan

1. Add a small overlay size contract module that parses the main Tauri window
   minimum and renders the WebView `:root` CSS variables.
2. Replace a marker in `index.html` from `vite.config.ts`; missing marker or
   invalid Tauri config fails the build.
3. Remove authored overlay min tokens and the unused XL breakpoint from
   `design-language.css`.
4. Move `currentUIScale()` into `layout-tokens.ts` with no default value and
   update pane, center workbench, screenshot browser, file explorer, config
   dialog, chat composer, and theme zoom callers.
5. Mark the old center workbench min-size spec as superseded by the current
   legal-shell cleanup.
6. Extend static tests for generated legal-frame tokens, scale fail-fast, and
   superseded spec status; then run focused tests, typecheck, browser visual
   QA, self-review, commit, and push.

### Acceptance

- `tauri.conf.json` is the only authored source for the overlay legal frame
  numeric minimums.
- WebView overlay min CSS variables are generated by Vite from that config.
- No production source keeps a silent UI scale fallback to `1` for resize or
  panel sizing work.
- The superseded 2026-06-22 spec no longer claims an active legal-shell compact
  branch.
- No fallback width, alternate legal-frame token, resize gate, or native resize
  feedback loop is introduced.

### Implementation

- Added `script/overlay-size-contract.ts` to parse the Tauri main window
  `minWidth/minHeight` and render the WebView `:root` legal-frame variables.
- Added an explicit `index.html` marker and a Vite HTML transform that replaces
  it with the generated overlay size contract; missing marker or invalid config
  fails the build.
- Removed authored overlay min tokens and the unused `--ui-breakpoint-xl` token
  from `design-language.css`.
- Moved `currentUIScale()` to `layout-tokens.ts` with no default value and
  updated pane, center workbench, screenshot browser, file explorer, config
  dialog, chat composer, and theme zoom callers.
- Marked `2026-06-22-center-workbench-panel-min-size-contract.md` superseded so
  it no longer reads as the active legal-shell compact plan.
- Tightened `side-activity-toolbar-browser.test.ts` so it waits for the
  frame-split separator semantics and stable Browser panel widths before
  asserting drag results.

### Verification

- PASS: `bun test packages/overlay/test/overlay-window-size-contract.test.ts packages/overlay/test/pane-config.test.ts packages/overlay/test/config-panel-sizing.test.ts packages/overlay/test/flat-redesign-breakpoint-coverage.test.ts packages/overlay/test/workspace-surface-consistency.test.ts --timeout 30000`.
- PASS: `bun run --cwd packages/overlay typecheck`.
- PASS after fixing the test harness settle wait: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/side-activity-toolbar-browser.test.ts packages/overlay/test/browser/screenshot-browser-panel-browser.test.ts packages/overlay/test/browser/left-pane-resizer-browser.test.ts`.
- Built HTML contains generated `#opencorvus-overlay-size-contract` with
  `1120x720` values from `tauri.conf.json`.
- Visual QA reviewed:
  `.scratch/side-activity-toolbar-illegal-narrow-legal-frame.png`,
  `.scratch/screenshot-browser-panel-browser.png`,
  `.scratch/screenshot-browser-panel-browser-narrow-panel.png`, and
  `.scratch/left-pane-resizer-illegal-narrow-legal-frame.png`.

### Self Review

- Rechecked source ownership: `design-language.css` no longer authors overlay
  legal-frame numbers or `--ui-breakpoint-xl`; WebView tokens are generated
  from Tauri config.
- Rechecked scale readers: resize/panel sizing callers use the shared
  `layout-tokens.ts` helper, and the old pane/ChatComposer/theme silent `1`
  fallbacks are gone.
- Rechecked old spec state: the 2026-06-22 min-size note is explicitly
  superseded by the 2026-06-23 legal-shell cleanup.
- Rechecked browser test failure: the production separator direction was
  correct; the side activity test sampled widths before frame-split layout had
  settled, so the test harness now waits for stable panel geometry.
