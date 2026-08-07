# Work Ledger Pinned Action Color

## Recall

| Item | Detail |
| --- | --- |
| User requirement | “置顶状态的任务按钮换个颜色，区分置顶和非置顶状态。” The supplied screenshot shows a hovered Work Ledger Task row whose Pin and Archive actions use the same neutral gray. |
| Acceptance criteria | A pinned Work Ledger item renders its Pin action in a clearly different theme color; an unpinned item retains the current neutral action color; hover and keyboard-focus access remain unchanged; the existing persisted `pinned` value remains the only state source; the real desktop page is opened, interacted with, captured, and personally reviewed. |
| Hard constraints | Desktop-only UI scope; reuse the existing `Button`, `Icon`, `data-pinned`, and theme `--accent` token; no fallback, compatibility path, second state source, hard-coded color, new primitive, state machine, gate, UI automation test, screenshot baseline, or pixel assertion; do not modify or run existing UI tests; use Node-backed Browser control for manual visual acceptance; preserve unrelated dirty `conversation.css` and architecture-document changes; commit subjects start with `dsw-33987` and push to `myhexin`. |
| Sources read | Root `AGENTS.md`; Browser control skill; `specs/current/architecture/07-panel.md`; `specs/records/2026-07/2026-07-29-codex-task-header-and-ledger-actions.md`; current `WorkLedger.tsx`; `App.tsx`; `ProjectLedgerGroup.tsx`; shared `Button.tsx`; button/icon/theme CSS; Work Ledger CSS; relevant existing test inventories. |
| Whole-repository search evidence | `WorkLedger.tsx` is the sole mixed Mission/Task/Chat/Work row renderer and writes the persisted row state to `data-pinned`; `work-ledger.css` is the sole row-action color override and currently gives every action the same neutral color; `services/work-ledger.ts` and `main.tsx` are the only Overlay item-pin mutation call sites and need no change. Other `data-pinned` consumers are the Conversation header menu (`App.tsx`), Project menu (`ProjectLedgerGroup.tsx` plus `sidebar.css`), and task-directory panel controls (`TaskDirBar.tsx`); they are separate surfaces and remain unchanged. |
| Independent agent feedback | None. The user did not request sub-agents, so no delegation was started. |

## Cause

The durable row already carries the correct boolean and the action button already
projects it through `data-pinned`. The shared Work Ledger action selector then
sets `--oc-button-color` to the same neutral value for every action and has no
pinned-state rule. The failure is therefore a missing state projection in the
single CSS owner, not a persistence, event, component, or icon problem.

## Complete Call-Site Disposition

| Owner / consumer | Decision |
| --- | --- |
| `WorkLedger.tsx` | Keep the current `data-pinned={row().pinned ? "true" : "false"}` projection and mutation behavior unchanged. |
| `work-ledger.css` | Add one shared Pin-action state selector for Mission, Task, Chat, and Work rows; pinned uses the existing accent token and unpinned continues to inherit the neutral action color. |
| `App.tsx` Conversation menu | Keep unchanged; it is a menu item, not the supplied hover action button. |
| `ProjectLedgerGroup.tsx` / `sidebar.css` | Keep unchanged; Project pinning is a separate group-menu surface with its own active glyph treatment. |
| `TaskDirBar.tsx` | Keep unchanged; its `data-pinned` describes panel-open ownership rather than persisted Work Ledger item pinning. |
| UI tests | Do not add, modify, update, delete, or run. |

## Implementation And Verification Plan

1. Land this Recall and the required spec indexes before changing the UI.
2. Add the pinned-state color rule to the canonical Work Ledger action owner,
   using the existing accent token and the existing `data-pinned` projection.
3. Run non-UI static verification only: formatting/diff checks, Overlay
   typecheck, and the production Vite build.
4. Start or reuse the real application page, expose pinned and unpinned row
   actions, capture a task-scoped desktop screenshot, and personally inspect
   the contrast in the supplied region.
5. Re-grep call sites, review the exact diff and screenshot a second time,
   commit only task-owned files, fetch/converge the current branch, and push to
   `myhexin`.

## Progress

- [x] Inspect the supplied screenshot, current owners, persisted state
  projection, theme tokens, related records, and git baseline.
- [x] Land the plan and required indexes.
- [x] Implement the single-source pinned action color.
- [x] Complete typecheck/build and real-page visual acceptance.
- [x] Complete the second screenshot and exact-diff review.
- [x] Commit the implementation and push it to git-cc.

## Verification Evidence

- Overlay TypeScript compilation passed.
- Prettier reported the changed Work Ledger stylesheet already formatted.
- The production Vite build completed after transforming 7,055 modules; only
  the existing dependency `use client` and large-chunk notices were emitted.
- Historical-link, document-health, and product-documentation single-source
  checks passed with 93 tests, zero failures, and 1,448 expectations.
- A source-built UI connected to an isolated OpenCorvus backend on
  `http://127.0.0.1:7891` with isolated data. Two real queued Task rows were
  created through the production API; one was persisted as pinned and one
  remained unpinned.
- The real keyboard action path exposed both rails. Personal screenshot review
  confirmed the pinned Pin glyph is theme blue while the unpinned Pin glyph and
  neighboring actions remain neutral gray, with unchanged row and action
  geometry. Computed inspection recorded pinned `rgb(9, 105, 218)` and the
  existing unpinned neutral color.
- Goal-bound screenshots are retained at
  `packages/overlay/.scratch/work-ledger-pinned-action-color.png` and
  `packages/overlay/.scratch/work-ledger-unpinned-action-color.png`.
- The Browser page, isolated backend, and Vite process were closed after
  acceptance. No user OpenCorvus process was restarted or modified.
- Concurrent unrelated edits moved from `conversation.css` and its architecture
  chapter to `App.tsx`, `RightDock.tsx`, `TaskDirBar.tsx`, and
  `WorkspaceEditorLaunchers.tsx` during this task; all remain preserved and
  excluded from this delivery.
- Implementation commit `04debf1812` is present on
  `myhexin/work-v0.0.24beta-yr-0729`. Its direct push completed every pre-push
  check but lost a concurrent remote-reference race; the concurrent branch
  update included the commit, and a fresh fetch confirmed it as an ancestor of
  the exact git-cc branch head.
