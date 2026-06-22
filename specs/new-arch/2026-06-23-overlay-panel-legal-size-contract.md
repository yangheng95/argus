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

## Fix Plan

1. Remove the overriding `min-width: 0` from `.left-activity-shell`.
2. Remove `body[data-resizing="true"] .pane-resizer::before` from the resize
   cursor selector list.
3. Add static tests that the left shell has exactly the token-owned minimum
   width and no same-rule zero override.
4. Add static tests that pane resize keeps the live `::after` selector and has
   no `::before` branch.
5. Run focused unit/static tests, overlay typecheck, browser visual tests,
   screenshot review, self-review, commit, and push.

## Acceptance

- `.left-activity-shell` cannot override its token minimum width with
  `min-width: 0`.
- Pane and center workbench minimums continue to come from layout tokens.
- Overlay aspect-ratio handling remains the existing legal layout-frame source;
  no alternate size source is added.
- The dead pane-resizer `::before` cursor selector is gone.
- Focused tests, browser visual QA, self-review, commit, and push pass.

## Verification

- PASS: `bun test packages/overlay/test/left-activity-toolbar.test.ts packages/overlay/test/pane-config.test.ts packages/overlay/test/pane-resizer-css.test.ts --timeout 30000`.
- PASS: `bun run --cwd packages/overlay typecheck`.
- PASS: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/side-activity-toolbar-browser.test.ts packages/overlay/test/browser/left-pane-resizer-browser.test.ts`.
- Visual QA reviewed:
  `.scratch/left-activity-toolbar-current-page.png`,
  `.scratch/left-pane-resizer-desktop-resize.png`,
  `.scratch/left-pane-resizer-component-compact-resize.png`, and
  `.scratch/left-pane-resizer-restored-desktop-resize.png`.

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
