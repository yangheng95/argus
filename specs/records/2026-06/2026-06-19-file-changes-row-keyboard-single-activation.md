# File Changes Row Keyboard Single Activation

## Recall

- `AGENTS.md` requires root-cause fixes, no fallback or compatibility paths, and a test for every code change.
- The existing file changes workbench is centralized in `FileChangesView`; `ChangesPanel` is the owner for board/agent change groups.
- Prior file changes work removed old chat-bubble file rows and moved rendering to the right-panel Files workbench.

## Independent Finding

Heisenberg reported that `FileChangesView` change rows are rendered as native buttons through Kobalte `Listbox.Item`, but the same element also manually calls `open()` from `onKeyDown` for Enter and Space without cancelling the key event.

## Evidence And Call Sites

| Surface                                                         | Evidence                                                                                                                                                                                                                                               | Decision                                                                                                                            |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `packages/overlay/src/components/FileChangesView.tsx`           | `ChangeRow` renders `<Listbox.Item as="button" type="button" class="change-row">` with `onClick={open}` and manual Enter/Space `onKeyDown`. Browser verification showed removing the key handler breaks Enter activation for this Kobalte composition. | Keep explicit keyboard activation, but cancel the key event before calling `open()`. Pointer activation remains owned by `onClick`. |
| `packages/overlay/src/components/ChangesPanel.tsx`              | Renders `<FileChangesView ... onRowClick={handleRowClick}>`.                                                                                                                                                                                           | No data-flow change.                                                                                                                |
| `packages/overlay/src/main.tsx`                                 | Mounts `FileChangesPanel` in the center workbench.                                                                                                                                                                                                     | Browser verification must use the real overlay fixture.                                                                             |
| `packages/overlay/test/agent-file-changes.test.ts`              | Static workbench ownership test exists, but does not guard row keyboard activation.                                                                                                                                                                    | Add absence guard for manual Enter/Space row activation.                                                                            |
| `packages/overlay/test/browser/toolbar-diff-navigation.test.ts` | Already launches the real overlay, opens the Files workbench, and screenshots the changes panel.                                                                                                                                                       | Extend it with keyboard activation assertions and a focused-row screenshot.                                                         |

## Root Cause

The row had an ambiguous activation contract: pointer activation used `onClick`, while keyboard activation manually called `open()` without cancelling the key event. In a Kobalte `Listbox.Item as="button"` composition, browser testing showed the native click path is not a reliable keyboard owner, but leaving the key event uncancelled risks duplicate activation if the browser or primitive also synthesizes a click.

## Fix Plan

1. Keep Kobalte `Listbox.Item` as the semantic row owner.
2. Keep `onClick={open}` as the pointer activation path.
3. Keep the row-level Enter/Space `onKeyDown`, but call `preventDefault()` and `stopPropagation()` before `open()` so keyboard activation has one owner.
4. Preserve list-level shortcuts (`/` and Ctrl/Cmd+F) on `Listbox.Root`.
5. Add static and browser tests proving keyboard activation toggles exactly once.

## Acceptance

- Pressing Enter on a focused `.change-row` expands the inline diff once.
- Pressing Space on the same focused row collapses it once.
- The focus ring remains visible for the focused row.
- No manual Enter/Space row activation handler remains in `FileChangesView`.
