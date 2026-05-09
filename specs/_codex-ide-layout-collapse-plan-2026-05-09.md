# IDE (Integrated Development Environment) Layout Collapse Plan

## Goal

Make the overlay project view expose compact workspace layout controls and allow both the left conversation sidebar and the right inspector sidebar to collapse to zero visible width.

## Implementation

- Put restore affordances in the project workspace strip beside the active directory context, so a collapsed pane does not need a residual rail and the window titlebar remains window/menu-only.
- Persist right inspector collapse state beside the existing left sidebar collapse state.
- Treat collapsed pane widths as zero in the pane layout service.
- Hide collapsed panes and their resize handles with `hidden`/`display: none`.
- Add a browser regression test that clicks both titlebar controls and asserts the panes and resize handles have no residual width.
- Follow-up visual correction: remove the floating edge collapse buttons and make the workspace command dock the only layout-control surface for left sidebar, workspace, and right inspector visibility.

## Verification

- `bun run --cwd packages/overlay check:i18n`
- `bunx tsc -p packages/overlay/tsconfig.json --noEmit`
- `bun run --cwd packages/overlay build:vite`
- `bun test --timeout 120000 packages/overlay/test/pane-collapse-layout.test.ts`
