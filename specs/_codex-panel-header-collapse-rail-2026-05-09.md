# Panel Header Collapse Rail

## Goal

Place the left and right side-panel collapse controls on the owning panel headers, matching the user-marked positions: left of `Recent Chats` and right of the right-panel tabs.

## Acceptance

- Left/right pane controls must not live in the workspace command dock, titlebar, or floating edge overlay.
- When expanded, the left control is before the left sidebar title and the right control is after the right-panel tabs.
- When collapsed, each side pane keeps a narrow header rail containing the same control, so clicking it expands the pane again.
- Resize handles remain hidden while the matching pane is collapsed.

## Verification

- `bunx tsc -p packages/overlay/tsconfig.json --noEmit`
- `bun test --timeout 120000 packages/overlay/test/pane-collapse-rail.test.ts`
- `bun run --cwd packages/overlay build:vite`
- `bun run --cwd packages/overlay check:i18n`
