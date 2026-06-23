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
