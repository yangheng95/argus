# Center Workbench Separator Accessibility

## Problem

Center workbench panel resizing is discoverable only by pointer hit-testing on
panel boundaries and CSS pseudo-elements. Keyboard users cannot focus or resize
the boundary, and assistive technologies do not receive separator semantics,
controlled panel IDs, or current width values.

## Call Points

| Surface | File | Decision |
| --- | --- | --- |
| Workbench panel order | `packages/overlay/src/main.tsx` `CENTER_WORKBENCH_PANEL_ORDER` | Keep DOM-order panel adjacency as the single boundary source. |
| Workbench DOM | `packages/overlay/src/index.html` `centerWorkbench*` views | Add real separator elements between peer panels; do not rely on pseudo-elements as the only handle. |
| Width persistence | `packages/overlay/src/store/settings.ts` `centerWorkbenchPanelWeights` | Keep persisted weight map as the only panel width state and delete the old outer `centerWorkbenchWidth` source. |
| Pointer resize | `packages/overlay/src/main.tsx` center workbench pointer listeners | Route separator pointerdown through the same pair resize math. |
| Keyboard resize | `packages/overlay/src/main.tsx` center workbench keydown listener | Add Arrow/Home/End resizing with the same clamp and persistence path. |
| CSS handle | `packages/overlay/src/styles/surfaces/workspace.css` | Style the real separator element and remove pseudo-element-only handle dependence. |
| Static tests | `packages/overlay/test/pane-config.test.ts`, `acceptance-panel-mount.test.ts` | Pin real separator DOM, ARIA attributes, and keyboard handler ownership. |
| Browser test | `packages/overlay/test/browser/side-activity-toolbar-browser.test.ts` | Focus a separator, press keys, and assert visible panel width changes. |

## Design

- Each separator is a real flex child with `role="separator"`,
  `aria-orientation="vertical"`, `aria-controls`, `aria-valuemin`,
  `aria-valuemax`, `aria-valuenow`, and `tabIndex=0` only when it separates two
  currently open panels.
- Hidden separators use `hidden` and `tabIndex=-1`.
- `ArrowLeft` decreases the left panel width, `ArrowRight` increases it,
  `Home` moves to the minimum, and `End` moves to the maximum.
- Pointer drag and keyboard resizing both compute the same adjacent panel pair,
  minimum width, total width, and weight update.
- The old hidden outer `centerWorkbenchResizer` is removed; it must not remain
  as a disabled fallback, storage key, or CSS-only handle.
- At mobile widths where CSS shows only the selected open panel, separators are
  hidden and removed from tab order.

## Verification

- `bun test packages/overlay/test/pane-config.test.ts packages/overlay/test/acceptance-panel-mount.test.ts`
- `bun run --cwd packages/overlay typecheck`
- `node packages\overlay\test\browser-runner.mjs packages\overlay\test\browser\center-workbench-separator-browser.test.ts`
- Visual screenshot review of the rendered workbench with multiple panels open.

## 2026-06-17 Follow-up Verification

- `bun test packages\overlay\test\pane-config.test.ts packages\overlay\test\acceptance-panel-mount.test.ts packages\overlay\test\file-explorer-editor.test.ts` passed.
- `bun run --cwd packages\overlay typecheck` passed.
- `node packages\overlay\test\browser-runner.mjs packages\overlay\test\browser\center-workbench-separator-browser.test.ts` passed.
- Visual review passed for `.scratch/center-workbench-separator.png`: workflow and inspector panels show one focused separator boundary, no legacy double border, no runtime error toast, and no overlapping controls.
- Independent follow-up audit found the left pane resizer remains pointer-only. That is a separate root issue because it lives in `services/pane.ts`; it should be handled in the next iteration with a shared separator a11y helper rather than folded into this center-workbench-specific deletion.
