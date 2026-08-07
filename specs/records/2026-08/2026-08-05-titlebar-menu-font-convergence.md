# Titlebar menu font convergence

## Recall

| Item                  | Evidence and requirement                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User request          | The Windows client titlebar menu labels (`File`, `Edit`, `View`, and `Help`) are visibly smaller than the left navigation. Make their font size match the left menu.                                                                                                                                                                                                                                                                                    |
| Acceptance criteria   | All four visible titlebar menu triggers use the same canonical navigation font-size token as the left Sidebar and Work Ledger, while retaining the current titlebar height, spacing, menu behavior, and dropdown typography.                                                                                                                                                                                                                            |
| Hard constraints      | Change the single presentation owner rather than adding a literal replacement size or caller-specific override. Preserve unrelated working-tree changes. Do not add, modify, or run User Interface (UI) automated tests. Verify through an isolated real page, screenshot, and personal visual review without restarting the operator's OpenCorvus client. Do not add a fallback, gate, second source, or worktree.                                     |
| Sources read          | Root `AGENTS.md`; `CLAUDE.md`; supplied screenshot; titlebar menu component and stylesheet; shared design-language typography tokens; Sidebar and Work Ledger styles; native-menu typography and titlebar-adjacent August records.                                                                                                                                                                                                                      |
| Whole-repository grep | `TitlebarMenubar.tsx` renders the four menu definitions through the one `data-ui="titlebar-menubar-trigger"` path. `titlebar.css` gives that path a hard-coded 12 scaled-pixel size. Sidebar shortcuts, Project rows, and Work Ledger rows use `--ui-font-navigation`; the token resolves to the 14 scaled-pixel body tier. Dropdown menu item titles already use the same navigation token. No second visible titlebar trigger style exists in source. |
| Independent review    | A session-local read-only reviewer completed without modifying the worktree. Claude Code 2.1.147 was also invoked with read-only tools, but external review was unavailable because the installed CLI is not authenticated (`Not logged in`).                                                                                                                                                                                                           |
| Git baseline          | Branch `work-v0.0.30beta-yr-0804` started at `93c97cc41d` with concurrent Environment popover changes in `TaskDirBar.tsx`, panel architecture, and August indexes. Those changes remain outside this task. The tracked legacy remote branch was fetched before implementation.                                                                                                                                                                                 |

## Causal chain

1. The left navigation intentionally uses `--ui-font-navigation`, which is the
   canonical 14 scaled-pixel body/navigation tier.
2. The titlebar menu trigger bypasses that token with a 12 scaled-pixel literal,
   so it remains two scaled pixels smaller even though its dropdown item titles
   already consume the canonical navigation tier.
3. Replacing the literal with `--ui-font-navigation` makes both regions follow
   one typography source and keeps future scale changes synchronized.

## Implementation and verification plan

1. Change the one titlebar menu-trigger rule to consume
   `--ui-font-navigation`; do not alter titlebar geometry, spacing, or dropdown
   presentation.
2. Run Overlay typecheck, internationalization validation, production Vite
   build, documentation health, and `git diff --check`. Do not run UI automated
   tests.
3. Launch an isolated real Overlay page, capture the titlebar and left
   navigation together at desktop size, personally compare the rendered text,
   and repeat after correction if needed.
4. Inspect the final diff, perform a second review, commit only task-owned
   changes with the `dsw-33987` prefix, reconcile the tracked legacy remote branch, and
   push through normal hooks.

## Progress

- [x] Recall, causal chain, and implementation plan recorded.
- [x] Product change complete.
- [x] Static verification complete.
- [x] Real-page visual acceptance and second review complete.
- [x] Commit and legacy remote push complete.

## Real-page visual evidence

- Launched the current Overlay source through an isolated Vite process and a
  headed Playwright browser at the client's configured `1280 × 760` desktop
  window size. The command closed the browser and exact Vite process after the
  capture; port 5187 was confirmed free afterward.
- The rendered `File` trigger and visible left-navigation `New chat` row both
  computed to `14px`. Personal review of
  `.scratch/titlebar-menu-font-qa/titlebar-sidebar-final.png` confirms all four
  titlebar labels remain readable, fit the existing 22 scaled-pixel controls,
  and visually match the left navigation size without clipping or crowding.
- A final session-local read-only reviewer completed after the screenshot and
  did not modify the worktree. Claude Code remained unavailable because the
  locally installed CLI is not authenticated.

## Verification

- `bun run typecheck` in `packages/overlay`: passed.
- `bun run check:i18n` in `packages/overlay`: passed with catalog hash
  `d0a34c94f99923db`.
- `bun run build:vite` in `packages/overlay`: passed after transforming 7,073
  modules. Existing third-party `use client` and large-chunk warnings remain.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`:
  passed, 2 tests and 2 expectations.
- `git diff --check`: passed before real-page acceptance and will be rerun on
  the final task-owned diff.
- No UI automated test was added, modified, or run.
