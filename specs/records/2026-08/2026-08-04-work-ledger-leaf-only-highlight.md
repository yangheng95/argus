# Work Ledger Leaf-Only Highlight

## Recall

| Item | Detail |
| --- | --- |
| User requirement | The Projects task list must highlight only the final selected level, such as a Chat or Task. Its owning Project stays expanded instead of automatically collapsing. |
| Acceptance criteria | Selecting a Chat or Task paints exactly that leaf row; the Project header has no selected/active wash or `aria-current`; the Project body remains expanded until the operator explicitly toggles it; a selected Mission child Task still keeps its Mission child drawer visible. |
| Hard constraints | Preserve `boardStore.selectedSource` as the sole selected-row source and the existing Project disclosure owner; remove the reintroduced Project active contract instead of masking its color; do not add, modify, or run UI automation tests; verify the desktop UI through a real native browser tab, screenshots, and manual review; preserve unrelated worktree changes; use Node for browser-backed verification; commit subjects start with `dsw-33987` and push to git-cc. |
| Records read | `specs/current/architecture/07-panel.md`; `specs/records/2026-07/2026-07-16-work-ledger-selection-primitive.md`; `specs/records/2026-07/2026-07-19-work-ledger-project-selection-retirement.md`; `specs/records/2026-07/2026-07-27-work-ledger-project-selection-order-stability.md`; `specs/records/2026-08/2026-08-02-work-ledger-active-mission-child-path.md`; current `WorkLedger.tsx`, `ProjectLedgerGroup.tsx`, `navigation-row.css`, `sidebar.css`, and `work-ledger.css`. |
| Whole-repository grep | The production chain is `main.tsx -> WorkLedger -> WorkLedgerProjectGroupView -> ProjectLedgerGroup / WorkLedgerRowView`. `boardStore.selectedSource` reaches leaf rows through `selectedTaskID` / `selectedSessionID`. Commit `c35c09367a` separately added Mission `activeDescendant` disclosure and reintroduced Project `activeProjectDirectory -> active -> data-active / aria-current`; that Project projection conflicts with the earlier leaf-only contract. Project collapse remains isolated in `createProjectLedgerGroupCollapseState` and is not driven by leaf selection. |
| Independent agent feedback | None. The user did not request sub-agents, and current collaboration policy forbids unrequested delegation. |

## Cause chain

1. A selected Chat or Task retains its owning directory as the runtime Project context.
2. `main.tsx` passes that directory to `WorkLedger`, which compares it with every Project group.
3. The matching group passes `active=true` to `ProjectLedgerGroup`.
4. `ProjectLedgerGroup` projects the context fact as navigation selection through `data-active` and `aria-current="location"`.
5. The shared navigation primitive therefore paints the Project header while the exact selected leaf independently paints itself.
6. The direct defect is the August reintroduction of Project selection semantics, not the disclosure state: Project collapse already has a separate operator-owned store and requires no replacement logic.

## Implementation plan

1. Remove `activeProjectDirectory` from the Work Ledger presentation contract and delete the Project-directory comparison.
2. Remove `active` from `ProjectLedgerGroup`, together with Project-header `data-active` and `aria-current`.
3. Preserve Mission `activeDescendant`, leaf `data-active`, and the Project disclosure state unchanged so selected descendants stay visible without highlighting ancestors or auto-collapsing the group.
4. Reconcile `specs/current/architecture/07-panel.md` with the leaf-only rule and retain the Mission child visibility contract.
5. Run Overlay typecheck, Vite build, localization checks, required documentation checks, and `git diff --check`; do not run UI tests.
6. Start the real desktop page, select visible Chat and Task leaves, move pointer/focus away, capture the Projects region, inspect it manually, and correct any remaining visual mismatch.
7. Review the final diff, commit only task-owned files, fetch, and push the current branch to git-cc.

## Progress

- [x] Inspect supplied screenshot, current production chain, historical decisions, architecture record, Git history, worktree, and remote state.
- [x] Record Recall, cause chain, implementation, and verification plan.
- [x] Commit the pre-implementation plan; push was attempted and timed out while the git-cc endpoint was unreachable.
- [x] Implement the leaf-only selection contract and architecture correction.
- [x] Complete non-UI verification and real-page visual acceptance.
- [x] Perform second review and commit the implementation.
- [x] Push the current branch to git-cc.

## Verification record

- Overlay TypeScript typecheck passed.
- Overlay localization validation passed with panel revision `00ef671c0043d3cf`.
- The Vite production build completed across 7,062 modules; only the existing dependency module-directive and large-chunk warnings remained.
- A temporary Node-hosted production build connected to the real OpenCorvus server on port 7878 and loaded the canonical Projects list. No iframe, query override, synthetic row, or UI test fixture was used.
- The real page selected the Task `完整竞品网页系统交付`, then removed pointer and keyboard focus from the Work Ledger. The settled state contained exactly one active row: `kind=task`, `aria-current=page`, and `visibility=visible`.
- The selected Task's owning Project remained expanded with its body present. Project headers exposed zero `data-active` values and Project toggles exposed zero `aria-current` values.
- The final desktop screenshot was manually reviewed. Only the Task leaf carries the selected wash; the owning `Anonymous 0fe780` Project header stays neutral and expanded, and the Mission/Task indentation and spacing remain intact.
- The right Conversation request timed out while loading the selected Task, but the independently rendered Work Ledger selection and disclosure state had already settled and remained inspectable; this server response does not own the left-list highlight contract.
