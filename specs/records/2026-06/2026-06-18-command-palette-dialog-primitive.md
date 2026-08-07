# Command Palette Dialog Primitive

Date: 2026-06-18
Status: Implementation plan

## Acronyms

- UI: User Interface, the visible command palette modal.
- DOM: Document Object Model, the rendered browser element tree.
- API: Application Programming Interface, the component props exposed by the shared dialog primitive.

## Problem

`CommandPalette` imports `@kobalte/core/dialog` directly and builds its own Root, Portal, backdrop, and Content shell. The shared `Dialog` primitive already owns Kobalte dialog wiring for feature components. Keeping a raw Kobalte dialog in `CommandPalette` creates a second dialog source for modal semantics, focus handling, outside click handling, and backdrop structure.

## Call Point Sweep

Command:

`rg "CommandPalette|command palette|Dialog primitive|dialog primitive|@kobalte/core/dialog" specs packages/overlay/src packages/overlay/test -n`

| Surface                 | Call points                                                                                                 | Decision                                                                                                                  |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `CommandPalette` mount  | `packages/overlay/src/components/App.tsx`                                                                   | Keep single app-level mount.                                                                                              |
| Raw Kobalte dialog      | `packages/overlay/src/components/CommandPalette.tsx`                                                        | Replace with `components/primitives/Dialog.tsx`.                                                                          |
| Shared dialog primitive | `packages/overlay/src/components/primitives/Dialog.tsx`                                                     | Add minimal API for overlay class and Kobalte focus event passthrough; keep Kobalte internals centralized here.           |
| Command palette CSS     | `packages/overlay/src/styles/surfaces/cmdk.css`                                                             | Re-target `.cmdk-backdrop`, `.cmdk-dialog`, and `.cmdk-panel` to the shared primitive DOM.                                |
| Static primitive tests  | `packages/overlay/test/command-palette-primitive.test.ts`, `packages/overlay/test/dialog-primitive.test.ts` | Invert tests so only the primitive may import `@kobalte/core/dialog`; `CommandPalette` must import `./primitives/Dialog`. |
| Browser behavior        | `packages/overlay/test/browser/command-palette.test.ts`                                                     | Keep hotkey/focus/Escape coverage and add screenshot evidence for the migrated DOM.                                       |

## Acceptance

- `CommandPalette.tsx` does not import `@kobalte/core/dialog` or render `KobalteDialog.*`.
- The only overlay component owning Kobalte dialog internals is `components/primitives/Dialog.tsx`.
- Cmd/Ctrl+K opens the palette, focuses search, Escape closes it, and focus returns to the trigger.
- The command palette keeps its compact search-panel visual layout through primitive class hooks.
- Browser verification captures a real screenshot of the migrated palette.

## Verification

- `bun test packages/overlay/test/command-palette-primitive.test.ts packages/overlay/test/dialog-primitive.test.ts`
- `OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER=1 node --test --test-timeout=60000 packages/overlay/test/browser/command-palette.test.ts`
- `bun run --cwd packages/overlay typecheck`
- Real browser screenshot of the open command palette.
