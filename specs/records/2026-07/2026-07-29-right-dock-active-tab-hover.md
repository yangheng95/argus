# Right Dock active-tab hover surface

## Recall

| Item                         | Evidence and requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User requirement             | Add a visible hover background color to the active Right Dock tab shown in the supplied desktop screenshot.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Supplied evidence            | The screenshot was inspected at its original `1085 × 686` resolution. It shows the compact Right Dock tab row with `审阅`, `文件`, and active `新标签页`; the selected tab needs a distinct hover response without changing its resting active appearance.                                                                                                                                                                                                                                                                                                                                                                               |
| Acceptance criteria          | The active tab keeps its current selected surface at rest and changes to the canonical hover surface only while the pointer is over the tab. Inactive hover, close/add/Dock-close controls, tab geometry, selection, focus, overflow, and native Browser tab identity remain unchanged. A real desktop page must be opened, the active tab must be hovered, and before/hover screenshots must be inspected manually.                                                                                                                                                                                                                     |
| Hard constraints             | Preserve the existing Kobalte Tabs primitive and the single `RightDock` renderer/state owner. Do not add JavaScript hover state, a second selector source, a feature gate, fallback, compatibility rule, new hard-coded color, responsive/mobile scope, or UI automated test. Do not add, modify, update, or run UI automated tests. Use Node-backed Browser control for interactive visual acceptance. Preserve unrelated dirty Conversation, Composer, test, and specification work.                                                                                                                                                   |
| Existing design records read | `specs/current/architecture/07-panel.md`; `2026-07-29-right-dock-chrome-adaptive-tab-width.md`; current `RightDock.tsx`; shared `primitives/tabs.css`; `workspace.css`; and the light, dark, and VS Code dark theme token sources.                                                                                                                                                                                                                                                                                                                                                                                                       |
| Whole-repository grep        | `RightDock.tsx` is the only production DOM owner of `.right-dock-tab`. `workspace.css` is the only production Right Dock paint owner and contains the sole selected and hover selectors. Shared `tabs.css` changes `--oc-tab-bg` on hover, but the Right Dock selected selector separately hard-sets the concrete `background`, so the variable mutation cannot repaint an active tab. `light.css`, `dark.css`, and `vscode-dark.css` are the only relevant palette owners: every palette already defines `--surface-hover` and `--surface-strong`. Existing UI tests mention these selectors but are intentionally untouched and unrun. |
| Independent review feedback  | No sub-agent was spawned because the user did not request delegation. Claude Code `2.1.147` was invoked from the repository root with only `Read,Grep,Glob`, no session persistence, and no edit/worktree/delegation tools, but stopped before repository inspection because the installed CLI is not authenticated (`Not logged in`). This unavailable review is recorded rather than represented as completed.                                                                                                                                                                                                                         |
| Git baseline                 | Delivery branch is `work-v0.0.24beta-yr-0729`; `HEAD` and `myhexin/work-v0.0.24beta-yr-0729` had zero divergence before task changes. The normal pre-push hook passed and the remote was already current. The worktree contains unrelated user-owned changes, so only task-owned hunks may be staged.                                                                                                                                                                                                                                                                                                                                    |

## Causal chain

1. Shared `.oc-tab:hover` correctly assigns the canonical hover surface to
   `--oc-tab-bg`.
2. The Right Dock selected rule assigns both `--oc-tab-bg` and a concrete
   `background: var(--right-dock-tab-active-bg)`.
3. The concrete surface declaration has no active-hover counterpart, so the
   selected tab remains on `--surface-strong` when the pointer enters it.
4. The first real-page pass proved that Kobalte keeps `data-highlighted` on the
   selected tab even when the pointer is elsewhere. Routing the selected paint
   through `--oc-tab-bg` unconditionally therefore collapsed rest and hover
   into the same `--surface-hover` color.
5. The corrected root fix keeps the concrete selected resting paint and adds a
   pointer-only selected rule that consumes the existing `--oc-tab-bg`. The
   shared primitive remains the sole hover-value owner, while Kobalte's
   highlighted selection semantics do not erase the visual state difference.

## Call-site disposition

| Owner / consumer                                     | Decision                                                                                                                                                                                                                             |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/overlay/src/styles/surfaces/workspace.css` | Preserve the selected rule's concrete resting background and add one selected `:hover` paint that consumes the existing `--oc-tab-bg` variable. Keep the current selected token, inactive-hover, focus, geometry, and control rules. |
| `packages/overlay/src/styles/primitives/tabs.css`    | Preserve. Its general hover contract is already correct; changing it would broaden the task to every tab surface and would not override the Right Dock's concrete selected background by itself.                                     |
| `packages/overlay/src/components/RightDock.tsx`      | Preserve. Pointer hover is native CSS interaction and does not require a second reactive state source.                                                                                                                               |
| Theme cascade files                                  | Preserve. All supported themes already expose the canonical semantic `--surface-hover` token.                                                                                                                                        |
| `specs/current/architecture/07-panel.md`             | Clarify that selected Right Dock tabs retain explicit hover feedback without changing tab behavior.                                                                                                                                  |
| `packages/overlay/test/**`                           | Do not modify or run because their assertions target rendered UI behavior and are prohibited for this task.                                                                                                                          |

## Implementation and verification plan

1. Preserve the selected resting paint and route pointer-only selected hover
   through `--oc-tab-bg` in the existing Right Dock surface owner.
2. Update the current panel architecture contract and this record without
   changing any component, state, route, locale, or theme source.
3. Run formatting/static validation, Overlay TypeScript, internationalization
   validation, and the production Vite build. Do not run UI tests.
4. Start the real desktop Overlay through the Browser skill, capture the active
   tab at rest and under real pointer hover, inspect both screenshots manually,
   and correct the styling if the state change is not clear in every exercised
   theme.
5. Perform a separate task-owned diff review, run the required documentation
   health checks, commit only the task-owned changes with the `dsw-33987`
   prefix, fetch/converge with `myhexin`, and push through normal hooks.

## Progress

- [x] Screenshot, current implementation, design tokens, related architecture,
      history, dirty-worktree boundaries, and all call sites inspected.
- [x] Root cause and implementation plan recorded.
- [x] Production style and architecture contract updated.
- [x] Static/build validation complete.
- [ ] Real active-tab rest/hover screenshots inspected. The real rest state was
      inspected, but strict hover screenshot evidence remains unavailable
      because the Browser control layer cleared CSS `:hover` after every
      pointer operation.
- [x] Second task-owned diff review, documentation health, commit, and git-cc
      push complete.

## Verification evidence

- `bun run --cwd packages/overlay typecheck` passed.
- `bun run --cwd packages/overlay check:i18n` passed with digest
  `6aa073ad759b98c7`.
- `bun run --cwd packages/overlay build:vite` passed after the corrected
  pointer-only selector was applied.
- The required historical links, product documentation single-source, and
  document-health tests passed: 93 tests, 0 failures, and 1,448 expectations.
- A source-built OpenCorvus instance was served on isolated port `7891` with an
  isolated OpenCorvus home, a real Git project, and a real Chat. The actual
  Right Dock Browser tab was opened and inspected at `1440 × 900`.
- In the corrected real page, the selected tab retained
  `background: rgb(255, 255, 255)` at rest even though Kobalte kept
  `data-highlighted`; the shared hover variable resolved to
  `rgb(240, 240, 240)`. This proves the rest and hover values remain distinct
  and that the pointer-only selector consumes the intended semantic value.
- The Browser control engine did not preserve `:hover` after moving, clicking,
  or dragging over coordinates whose hit target was verified as
  `.right-dock-tab`; therefore a hover-state screenshot could not be captured.
  This evidence gap is not represented as visual acceptance.
- The isolated server shut down cleanly after inspection. Its unique temporary
  home remains because the environment blocked the cleanup command before it
  executed.
- Task-owned implementation commit `43341c108b` passed the normal pre-push
  TypeScript, route inventory, documentation, internationalization, and secret
  scan hooks and was pushed to
  `myhexin/work-v0.0.24beta-yr-0729`.
