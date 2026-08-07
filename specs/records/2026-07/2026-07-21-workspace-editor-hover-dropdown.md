# Workspace Editor Hover Dropdown

## Recall

| Item | Evidence |
| --- | --- |
| User request | Change the chat-header `打开于` / `Open in` editor launcher shown in the supplied screenshot so its dropdown appears on mouse hover instead of requiring a click. |
| Acceptance criteria | Hovering either half of the split launcher opens the existing editor/file-manager menu; moving through the placement gap into the menu keeps it open; leaving both launcher and menu closes it; the primary button still opens the selected editor; keyboard users can still open and operate the Kobalte menu; focused source, interaction, type, build, document-health, and visually reviewed screenshot checks pass. |
| Hard constraints | Keep Kobalte `DropdownMenu` as the only menu behavior and accessibility source; do not create a second menu, fallback, compatibility path, gate, state machine, hidden message, or hand-written dropdown; preserve all pre-existing uncommitted files; do not restart, refresh, close, or otherwise disturb the running OpenCorvus/overlay; use a Node-launched isolated browser fixture and inspect a task-scoped screenshot. |
| Sources read | Root `AGENTS.md`; Browser skill instructions; `specs/README.md`; `specs/records/2026-07/README.md`; `2026-07-15-workspace-file-manager-launcher.md`; `WorkspaceSplitLauncher.tsx`; `WorkspaceEditorLaunchers.tsx`; shared `DropdownMenu.tsx`; conversation/dropdown styles; focused unit and browser tests; the installed Kobalte package surface. |
| Whole-repository search evidence | `WorkspaceSplitLauncher` has one production caller: `WorkspaceEditorLaunchers`; `WorkspaceEditorLaunchers` alone owns the controlled `open` signal and the editor/file-manager actions; the menu trigger/content/item semantics are projected only through the shared Kobalte-backed `DropdownMenu`; existing interaction coverage is in `workspace-split-launcher-primitive.test.ts` and the Node browser test `titlebar-toolbar-toggle-browser.test.ts`; menu geometry is owned by `conversation.css` and shared highlighted state by `dropdown-menu.css`. |
| Independent agent feedback | No independent agents were requested, so none were started. The main agent completed the required repository-wide call-site audit. |

## Root cause

The split launcher already exposes controlled Kobalte open state, but only the nested
`DropdownMenu.Trigger` can request it, so a mouse user must click the caret segment.
The surrounding launcher and portaled menu are not one hover region. Because the
content is separated from the trigger by a six-pixel placement gutter, an immediate
leave handler would also close the menu while the pointer is crossing into it. The
Kobalte root was also modal by default, which correctly serves click-open menus but
blocks real pointer movement outside the portaled layer and would prevent a
hover-open menu from tracking the launcher-to-content path.

## Call-site disposition

| Surface | Decision |
| --- | --- |
| `WorkspaceSplitLauncher.tsx` | Become the single hover-intent owner for its launcher wrapper and Kobalte content. Open on mouse enter, cancel a pending close on menu enter, and close after one short shared delay when the mouse has left both surfaces. Clear the timer on cleanup. |
| `WorkspaceEditorLaunchers.tsx` | Keep unchanged as the sole controlled open-state and launcher-action owner. |
| `ui/DropdownMenu.tsx` | Keep unchanged as the sole Kobalte primitive adapter and menu semantics source. |
| `conversation.css` and `dropdown-menu.css` | Keep layout and visual tokens unchanged unless screenshot evidence proves a defect; the requested change is interaction-only. |
| `workspace-split-launcher-primitive.test.ts` | Assert hover-region ownership, delayed cross-gap close, cleanup, and continued Kobalte delegation. |
| `titlebar-toolbar-toggle-browser.test.ts` | Replace click-only opening with real mouse hover, verify open/retain/close behavior, re-open through the keyboard trigger, activate the existing file-manager item, and capture the open menu. |

## Implementation and verification

1. Add hover-intent handlers around the existing split launcher and portaled Kobalte content.
2. Extend focused unit assertions for the new hover contract without testing implementation-irrelevant styling.
3. Extend the existing Node browser fixture to prove mouse and keyboard behavior plus the canonical native file-manager action.
4. Run focused unit tests, Overlay typecheck, production Vite build, historical-document link tests, and relevant document-health checks.
5. Use an isolated browser surface, capture the current chat-header/menu delivery region, inspect it at original resolution, and correct any visual or interaction mismatch before re-running verification.
6. Review the final diff against this Recall, commit only task-owned changes with the required `dsw-33987` prefix, and push `v0.0.13beta` to the legacy remote.

## Validation record

- `bun test packages/overlay/test/workspace-split-launcher-primitive.test.ts`: 4 passed, 45 assertions.
- Focused Node/Playwright browser test `workspace editor menu opens on hover and launches the active project through keyboard access`: passed against the isolated real Overlay fixture. It proved hover open, focus preservation, the launcher/content gap bridge, outside close, keyboard reopen, keyboard item focus, and the native file-manager call.
- `bun test` across `workspace-split-launcher-primitive`, `dropdown-menu-primitive`, `overlay-architecture-guards`, and `composer-file-loader-right-dock`: 136 passed, 8,402 assertions.
- `bun run --cwd packages/overlay typecheck`: passed.
- `bun run --cwd packages/overlay build:vite`: passed (the existing bundle-size warning remains informational).
- `historical-docs-links.test.ts`: passed. The combined document-health run reported one working-tree-only failure because three unrelated July records are linked while still untracked by their parallel tasks; this task neither owns nor stages those records.
- Visual review: `.scratch/workspace-editor-file-manager-option.png` was inspected at original resolution. All six launcher items are visible, aligned, unclipped, and retain the established dark Kobalte menu styling; no CSS change was necessary.
