# IDE (Integrated Development Environment) Layout Collapse Plan

## Goal

Make the overlay project view expose compact workspace layout controls and allow both the left conversation sidebar and the right inspector sidebar to collapse to zero visible width.

## Implementation

- Put side-panel collapse affordances in the owning panel headers: left of the left sidebar title and right of the right inspector tabs, so the window titlebar remains window/menu-only and workspace commands remain workspace-owned.
- Persist right inspector collapse state beside the existing left sidebar collapse state.
- Treat collapsed pane widths as zero in the pane layout service.
- Hide collapsed panes and their resize handles with `hidden`/`display: none`.
- Add a browser regression test that clicks both panel-header controls and asserts the panes and resize handles have no residual width.
- Follow-up visual correction: remove the floating edge collapse buttons and remove left/right side-panel controls from the workspace command dock; the dock only owns workspace-level actions.

## Verification

- `bun run --cwd packages/overlay check:i18n`
- `bunx tsc -p packages/overlay/tsconfig.json --noEmit`
- `bun run --cwd packages/overlay build:vite`
- `bun test --timeout 120000 packages/overlay/test/pane-collapse-layout.test.ts`
