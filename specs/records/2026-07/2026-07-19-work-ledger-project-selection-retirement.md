# Work Ledger Project Selection Retirement

## Recall

| Item | Detail |
| --- | --- |
| User requirement | Do not show Project and Task / Mission / Chat as selected at the same time. Keep the selected Task, Mission, or Chat state; Project rows do not need a selected state. |
| Acceptance criteria | A Project group header never exposes selected navigation state or selected background; the current Task, Mission, or Chat row remains the only selected Work Ledger row; project disclosure, project-context switching, hover/focus feedback, menus, and actions remain functional; browser coverage proves zero selected Project headers and at most one selected child row. |
| Hard constraints | Keep `ProjectLedgerGroup` as the canonical Project-row owner and `WorkLedgerRowView` as the canonical child-row selection owner; preserve `applyDirectory` through `onSelectProject` as the single project-context lifecycle; remove the obsolete Project active contract instead of masking it with a style override; use existing Button and navigation-row primitives; desktop-only scope; do not restart, refresh, close, or otherwise interfere with the user's running OpenCorvus or Overlay process; launch Playwright through Node; do not create a worktree or overwrite unrelated changes; commit subjects start with `dsw-33987` and push to the current legacy remote branch. |
| Sources read | Repository `AGENTS.md`; Browser control skill; the supplied double-selection screenshot; `specs/README.md`; `specs/records/2026-07/README.md`; `specs/current/architecture/99-principles.md`; Round 25 of `2026-07-10-overlay-codex-strict-parity-remediation.md`; `2026-07-18-project-name-normal-font-weight.md`; current `ProjectLedgerGroup.tsx`, `WorkLedger.tsx`, `sidebar.css`, navigation-row primitive, and focused source/browser tests. |
| Whole-repository search evidence | `rg` enumerated every production and test reference to `ProjectLedgerGroup`, `projectSelected`, Project-header `data-active`, Project-header `aria-current`, and the selected Project screenshots. Production has one Project selected-state producer in `ProjectLedgerGroup`, one caller projection in `WorkLedger`, and one Project-active style override in `sidebar.css`. Focused consumers are `navigation-row-primitive.test.ts`, `sidebar-surface-continuity.test.ts`, `project-directory-new-chat-browser.test.ts`, and `project-ledger-group-browser.test.ts`. Other `projectActive` search hits belong to expert-squad configuration and are unrelated. |
| Independent agent feedback | None. The user did not request sub-agents, and the active collaboration policy forbids unrequested delegation. |

## Cause chain

1. The screenshot shows both the current Project header and one child item using the same selected navigation-row wash.
2. `WorkLedger` independently computes the selected child from the selected Task or session identifier, which is the required user-facing selection.
3. The same component also computes `projectSelected(directory)` from the active project directory and passes it to `ProjectLedgerGroup`.
4. `ProjectLedgerGroup` projects that directory context as `data-active` and `aria-current`, so the shared navigation-row primitive renders a second selected surface.
5. The direct cause is therefore a semantic conflation between active project context and selected Work Ledger item. Removing only the background would leave false accessibility and test semantics, so the Project active prop and projection must be retired completely.

## Call-site disposition

| Owner / call site | Decision |
| --- | --- |
| `ProjectLedgerGroup.tsx` | Remove the optional `active` prop, Project-header `data-active`, and Project-toggle `aria-current`; preserve disclosure and `onSelectProject`. |
| `WorkLedger.tsx` `WorkLedgerProjectGroupView` | Remove its `active` input and stop passing Project selection into the group. |
| `WorkLedger.tsx` `projectSelected` | Delete the obsolete helper; retain `activeProjectDirectory()` for current-directory actions. |
| `sidebar.css` | Delete the now-unreachable Project-active text-color override; keep hover/focus styling and the shared selected-child primitive. |
| `navigation-row-primitive.test.ts` | Replace the historical double-selection contract with source assertions that Project groups cannot produce selected state while child rows still do. |
| `sidebar-surface-continuity.test.ts` | Require absence of a Project-active selector and preserve the shared selected-row surface contract. |
| `project-directory-new-chat-browser.test.ts` | Prove project-context switching through the authoritative directory stores and launcher copy, while asserting that no Project header becomes selected. |
| `project-ledger-group-browser.test.ts` | Change initial, child-selected, and Project-click assertions to zero Project selections, one selected child when applicable, and zero selected rows after selecting only the Project context; regenerate and inspect the task-scoped screenshot. |
| Spec indexes | Register this record in the July and root catalogs. |

## Implementation and verification

1. Commit and push this Recall and complete call-site plan before changing production code.
2. Remove the Project selected-state contract at its producer and caller, then update focused source and browser regressions.
3. Run focused source tests, Overlay typecheck, formatting, and required documentation-health tests.
4. Run the isolated production Work Ledger browser fixture through Node, inspect the task-scoped screenshot, and correct any visual mismatch.
5. Review the final diff and repository status, commit only task-owned files, and push the current branch to legacy remote.

## Progress

- [x] Inspect user evidence, prior decisions, canonical owners, complete call sites, tests, and remote baseline.
- [x] Record Recall, cause chain, call-site disposition, and verification plan.
- [x] Commit and push the pre-implementation plan.
- [x] Implement Project selection retirement and regression coverage.
- [x] Complete source, type, documentation, browser, and visual verification.
- [x] Perform second review and prepare the final task-owned commit.

## Verification record

- Focused navigation-row and sidebar-surface source regressions passed with `3 pass / 0 fail` and prove that `ProjectLedgerGroup` cannot emit `data-active` or `aria-current`, while Task, Mission, and Chat rows retain the canonical child-selection projection.
- Overlay TypeScript typecheck passed after the production and browser-test changes.
- The Node-launched production Work Ledger browser fixture passed after a fresh Vite production build. It selects a Task, Mission, and Chat in turn and requires exactly one selected Work Ledger row, zero selected Project headers, and child `aria-current="page"`. The fixture also proves Project-only context activation clears the child selection without creating a Project selection.
- The same browser fixture records exactly the two expected session-event stream cancellations caused by Mission-to-Chat-to-Project switching and still requires zero unexpected console, request, or response errors.
- The independent Node-launched project-directory/new-Chat fixture passed and proves Project context switching still updates the authoritative directory and launcher title while no Project header gains selected state.
- Personally reviewed `.scratch/work-ledger-child-only-selected.png` from the final browser run. The selected Task is the only row with the gray selected wash; its Project header remains visually neutral, with folder, title, and actions aligned and no residual parent highlight.
- Historical-link, document-health, and product-document single-source verification passed with `84 pass / 0 fail`; final targeted diff review found no compatibility path, duplicate selected-state source, or unrelated task-owned change.
