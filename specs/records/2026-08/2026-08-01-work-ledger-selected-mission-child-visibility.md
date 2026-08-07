# Work Ledger selected Mission child visibility

## Recall

| Item                           | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User requirement               | Restore the visible selected state in Projects so the row corresponding to the center message panel is always identifiable, and reuse the Task selected treatment for Mission entries.                                                                                                                                                                                                                                                                                                                                                                                     |
| Acceptance criteria            | A selected top-level Task remains highlighted; a selected Mission session highlights its Mission row with the same navigation-row primitive; a selected Task nested under a Mission remains rendered and highlighted at rest after pointer and focus leave the Mission; no Project or Mission parent receives a duplicate selected state while a child Task is selected.                                                                                                                                                                                                   |
| Hard constraints               | `boardStore.selectedSource` remains the sole selected work-item source. Reuse `WorkLedgerRowView`, `oc-navigation-row`, and `data-active`; do not add a shadow selection store, a second visual primitive, a compatibility branch, a gate, a fixture, or a responsive/mobile scope. Do not add, modify, update, or run User Interface automated tests. Use a real desktop page and personally inspect screenshots. Preserve unrelated dirty-worktree changes. Commit subjects start with `dsw-33987` and push the current main branch to `legacy-remote`.                        |
| Sources read                   | User screenshot; repository `AGENTS.md`; Browser control skill; `WorkLedger.tsx`; `work-ledger.css`; `navigation-row.css`; `sidebar.css`; `main.tsx`; `store/board.ts`; Work Ledger transport and projection; the July Work Ledger selection, Mission drawer, and child status records.                                                                                                                                                                                                                                                                                    |
| Whole-repository grep evidence | Searches covered every `WorkLedger` mount, `selectedTaskID`, `selectedSessionID`, `activeTaskID`, `activeSessionID`, `selectedSource`, `data-active`, `.oc-navigation-row`, `.work-row-child-drawer`, Mission row/session identity, and selected-child browser/source assertion. `main.tsx` is the only Work Ledger mount; `WorkLedger.selected` is the only row-selection projector; `WorkLedgerRowView` is the only parent/child row renderer; `work-ledger.css` is the only child-drawer visibility owner; `navigation-row.css` is the only shared selected wash owner. |
| Independent agent feedback     | None. The user did not request sub-agents, and current collaboration policy forbids unrequested delegation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

## Cause chain

1. The center panel selects a canonical Task through `boardStore.selectedSource`; `WorkLedger.selected` correctly projects that Task ID to the nested Task row.
2. Mission-owned Tasks are mounted below their Mission by `WorkLedgerTaskChildRow`, and the selected Task receives the same `data-active="true"` and `aria-current="page"` contract as a top-level Task.
3. `work-ledger.css` collapses every Mission child drawer unless its parent shell is hovered or contains keyboard focus.
4. Once pointer and focus leave, the selected Task remains semantically active but becomes invisible, so the sidebar exposes no visible indication of which Task owns the center transcript.
5. Painting the Mission parent as selected would create two selected work items and lose exact Task identity. The root repair is to keep the existing selected child visible and let a directly selected Mission session continue using the same row primitive.

## Call-site disposition

| Owner / call site                      | Decision                                                                                                                                                                                     |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main.tsx` Work Ledger mount           | Preserve `activeTaskID()` and `activeSessionID()` as projections of the canonical selected source.                                                                                           |
| `WorkLedger.selected`                  | Preserve Task-ID and session-ID matching; no second selection identity is added.                                                                                                             |
| `WorkLedgerRowView`                    | Derive whether a Mission owns the selected child using the existing `isSelected` callback and expose that fact on the Mission shell.                                                         |
| `WorkLedgerTaskChildRow`               | Preserve the existing selected Task row and shared navigation primitive.                                                                                                                     |
| `work-ledger.css`                      | Extend the existing drawer-open selector so a Mission with a selected child remains expanded at rest; reuse the current motion and opacity rules.                                            |
| `navigation-row.css` and `sidebar.css` | Preserve unchanged; `oc-navigation-row[data-active="true"]` remains the sole selected paint owner.                                                                                           |
| Directly inspected legacy UI tests     | Delete `mission-html-entry.test.ts`, `navigation-row-primitive.test.ts`, and `work-ledger-top-level-alignment.test.ts` under the repository UI-test prohibition; do not replace or run them. |
| Spec indexes                           | Register this record in the August and root indexes without overwriting concurrent index edits.                                                                                              |

## Implementation plan

1. Add one derived selected-child fact to the Mission row shell and include it in the existing drawer visibility selector.
2. Delete the directly inspected obsolete User Interface source-assertion tests required by the repository rule.
3. Run formatting, TypeScript typecheck, Vite build, document health, and diff checks; do not run User Interface automated tests.
4. Open a real desktop page, select a Mission-owned Task, move pointer/focus away, capture and inspect the Projects/message region, then directly select a Mission and confirm the same selected row treatment.
5. Perform a second source/diff review, create task-only commits from current `HEAD`, fetch the remote branch, and push to `legacy-remote` without disturbing parallel changes.

## Progress

- [x] Inspect the user evidence, current selection source, all production call sites, drawer styles, prior decisions, and touched tests.
- [x] Commit and push the pre-implementation plan.
- [x] Implement persistent visibility for the selected Mission child.
- [x] Complete static, build, real-page, screenshot, and documentation validation.
- [ ] Complete second review, scoped delivery commit, and legacy remote push.

## Validation record

- Overlay TypeScript typecheck passed.
- Overlay Vite production build passed with only the existing large-chunk warning.
- Historical links, document health, and product-document single-source checks initially passed with 70 tests and 1,188 assertions. A final rerun after concurrent worktree changes passed 68/70: its two failures name a concurrently deleted `general/expert-squad.jsonc` and an August index link to another untracked record; neither intersects this repair and neither was restored or staged.
- No User Interface automated test was added, modified, or run. The three directly inspected obsolete source-assertion test files were deleted under the repository rule.
- Real desktop acceptance used the current production Overlay and OpenCorvus server against an isolated SQLite backup of the live catalog; host recovery was scoped to an empty temporary project and reported `attempted=0`, so the user's running application, database, Tasks, and worktree were not touched.
- After selecting the real nested Task `Phase 01: AI 编程工具选型调研与对比` and moving focus to the center Composer, the Mission shell retained `data-has-selected-child="true"`; the drawer stayed `visible` at 56 pixels, the selected child stayed at opacity 1, and exactly one Work Ledger row remained active. The Mission parent had no active attribute. The center header and selected row named the same Task.
- Direct Mission selection then produced exactly one active `data-kind="mission"` row with `aria-current="page"` after focus left the row, proving Mission consumes the same navigation-row selection primitive.
- Screenshots were personally inspected at `.scratch/work-ledger-selected-mission-child.png` and `.scratch/work-ledger-selected-mission.png`. The selected child is visible and indented below its neutral Mission parent; direct Mission selection uses the same quiet gray wash with no duplicate Project selection.
- The isolated copied database predates a concurrent `workflow_binding` transport change in the dirty worktree, so the child transcript request displayed that unrelated schema error after the selected Task identity and header had already switched. Mission transcript rendering and both selection surfaces remained available; no production database or concurrent schema work was changed for this UI repair.
