# Retire Right Pane Layout State

Date: 2026-06-23
Status: Verified

## Acronyms

- ARIA: Accessible Rich Internet Applications, attributes exposed to assistive technologies.
- CSS: Cascading Style Sheets, the browser styling language.
- GUI: Graphical User Interface, the visible overlay surface.
- RAF: Request Animation Frame, the browser callback used to batch visual work once per frame.
- UI: User Interface, visible controls and layout surfaces.

## Task Definition

Remove the retired right pane layout state from the overlay pane source. The
default pane has one left separator; right inspector and notifications panels
belong to the center workbench and right activity toolbar. Stale
`sectionsWidth`, `rightPanelCollapsed`, `oc_sections_width`,
`oc_right_panel_collapsed`, and `--ui-sections-width` must not constrain pane
resize ranges or survive as a second layout source.

## Recall

| Source | Constraint carried forward |
| --- | --- |
| `AGENTS.md` | No fallback, no duplicate source, no blind patching, test every change, visually verify UI work, and commit/push every round. |
| `2026-06-17-pane-resizer-right-css-retirement.md` | Runtime DOM has no `#rightPaneResizer`; do not reintroduce a placeholder right handle. |
| `2026-06-17-left-pane-resizer-accessibility.md` | Pane handle semantics belong in `services/pane.ts`; keep one renderer. |
| `2026-06-18-retire-workspace-panel-residue.md` | Remove retired surfaces instead of keeping old selectors/contracts alive. |
| `2026-06-18-right-activity-toolbar-responsive-rail.md` | Right activity UI is the shared toolbar/center workbench path, not a default pane column. |
| `2026-06-22-pane-semantics-layout-frame.md` | Pane layout and ARIA rendering remain owned by the pane service and RAF-separated semantics. |
| `2026-06-23-overlay-panel-legal-size-contract.md` | Illegal panel widths must not be written when token minimums cannot be satisfied. |

## Call Point Inventory

| Search | Findings | Decision |
| --- | --- | --- |
| `rightPanelCollapsed`, `sectionsWidth` in `packages/overlay/src` | `main.tsx`, `store/settings.ts`, `overlay-settings-storage.ts`, `TitlebarMenubar.tsx`, and `services/pane.ts` still persisted and scheduled retired right pane state. | Delete the settings fields and pane callbacks; left pane state only has `sidebarCollapsed` and `sidebarWidth`. |
| `rightHandleId`, `rightControls`, `sectionsVar`, `defaultSectionsWidth` | `PANEL_PANE_CONFIG` kept null right-handle placeholders and `renderPaneLayout()` wrote `--ui-sections-width`. | Remove the right handle API from `PaneConfig`; write only `--ui-sidebar-width`. |
| `oc_right_panel_collapsed`, `oc_sections_width` | Browser settings storage read and wrote the retired keys; many browser tests still seeded them. | Remove storage read/write and cleanup dead test setup lines, keeping explicit stale-key regression tests. |
| `--ui-sections-width` | Fixed-string search found only the token definition and tests after source removal. | Delete the dead CSS token and update theme/token tests. |
| Browser pane resize instrumentation | `left-pane-resizer-browser.test.ts` and `center-workbench-separator-browser.test.ts` still treated `--ui-sections-width` as a pane resize write. | Track only `--ui-scale` and `--ui-sidebar-width`; add stale-key max-range coverage before installing geometry probes. |

## Root Cause

The right pane DOM and handle had already been removed, but the old persisted
right pane state still flowed through settings and pane resize math. Because
`resolvedPaneWidths()` reserved a phantom sections rail, the left separator's
legal maximum could be reduced by an unmounted pane. Browser localStorage also
kept old keys alive in tests, making it easy for the retired source to re-enter
the layout path unnoticed.

## Fix

1. Collapse `PaneConfig`, `PaneState`, and `PaneCallbacks` to the default left
   pane source.
2. Remove all right-side pane drag, keyboard, semantics, and persistence
   branches from `services/pane.ts`.
3. Remove `rightPanelCollapsed` and `sectionsWidth` from overlay settings,
   browser localStorage storage, and titlebar reset layout.
4. Remove dead browser-test setup writes for the retired localStorage key,
   except the explicit stale-key regression tests.
5. Delete the unused `--ui-sections-width` token.
6. Extend tests so stale right-pane localStorage does not affect the left pane
   `aria-valuemax`.

No fallback, compatibility path, or alternate right pane source is introduced.

## Verification

- PASS: `bun test packages/overlay/test/pane-config.test.ts packages/overlay/test/pane-resizer-css.test.ts packages/overlay/test/right-panel-defaults.test.ts packages/overlay/test/resize-observer-frame-scheduler.test.ts packages/overlay/test/acceptance-panel-mount.test.ts packages/overlay/test/overlay-window-size-contract.test.ts packages/overlay/test/flat-redesign-theme-symmetry.test.ts --timeout 30000`.
- PASS: `bun run --cwd packages/overlay typecheck`.
- PASS: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/left-pane-resizer-browser.test.ts`.
- PASS: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/center-workbench-separator-browser.test.ts`.
- PASS: `git diff --check -- packages/overlay/src packages/overlay/test`.

## Visual Review

- `.scratch/left-pane-resizer-accessibility.png`: left pane can expand without
  reserving a phantom right pane; chat/input remains visible.
- `.scratch/left-pane-resizer-restored-desktop-resize.png`: restored desktop
  layout has coherent left pane, workbench, right toolbar, and chat composer.
- `.scratch/center-workbench-separator-desktop-resize.png`: center workbench
  inspector and chat remain separated by the center workbench owner.
- `.scratch/center-workbench-separator-restored-desktop-resize.png`: restored
  center workbench layout keeps legal panel widths after separator testing.
- `.scratch/left-pane-resizer-component-compact-resize.png` and
  `.scratch/center-workbench-separator-narrow-resize.png`: the browser test
  viewport captures the 1120px minimum layout from a narrower viewport; native
  overlay minimum-size tests remain the legal-window acceptance.

## Self Review

- Rechecked fixed-string searches: production source has no `sectionsWidth`,
  `rightPanelCollapsed`, `rightHandleId`, `rightControls`, `sectionsVar`,
  `defaultSectionsWidth`, `oc_sections_width`, or
  `oc_right_panel_collapsed`.
- Rechecked `--ui-sections-width`: the dead token is removed; only a negative
  contract test mentions it.
- Rechecked browser instrumentation: the stale-key max-range calculation runs
  before geometry probes are installed, so the benchmark measures product
  layout work instead of test helper reads.
- Rechecked center workbench ownership: inspector/notifications still use
  center workbench panel weights and separators, not default pane state.
