# Project Name Normal Font Weight

## Recall

| Item | Detail |
| --- | --- |
| User requirement | The project name in the left Projects list should not be bold. |
| Acceptance criteria | Every project name rendered by the canonical Project row computes to the normal body font weight; size, color, truncation, row geometry, actions, hover, focus, selection, and project behavior remain unchanged; a focused source regression, Overlay typecheck, isolated Node-launched browser verification, and a task-scoped screenshot pass. |
| Hard constraints | Keep `ProjectLedgerGroup` and `.project-group-name` as the single markup and style owners; use the existing typography token instead of a literal; add no duplicate project row, compatibility rule, or feature gate; desktop-only scope; do not restart, refresh, close, or otherwise interfere with the user's running OpenCorvus or Overlay process; launch Playwright through Node; do not create a worktree or overwrite unrelated changes; commit subjects start with `dsw-33987` and push to `myhexin/work-v0.0.8beta-yr-0717`. |
| Sources read | Repository `AGENTS.md`; Browser control skill; the supplied project-row screenshot; `specs/README.md`; `specs/records/2026-07/README.md`; the prior Project-row surface, titlebar/sidebar typography, and pin optical-size records; `ProjectLedgerGroup.tsx`; `sidebar.css`; focused source tests; and current Project-row browser fixtures. |
| Whole-repository search evidence | `rg` enumerated every `project-group-name`, `ProjectLedgerGroup`, and project-row test reference. `ProjectLedgerGroup.tsx` contains the only production project-name element; `sidebar.css` contains its only production selector and currently assigns the strong 600 token; source and browser tests are the only remaining references. No second project-name styling implementation exists. |
| Independent agent feedback | None. The user did not request sub-agents, and the active collaboration policy forbids unrequested delegation. |

## Cause chain

1. The supplied screenshot shows the project name heavier than the surrounding left-navigation copy.
2. Every production Project row renders its name through `ProjectLedgerGroup.tsx` as `.project-group-name`.
3. The sole selector assigns `--ui-font-weight-strong`, whose design-token value is 600.
4. The direct and root cause is therefore the semantic token chosen by the canonical selector, not inherited browser styling or a duplicate row implementation.

## Call-site disposition

| Owner / call site | Decision |
| --- | --- |
| `ProjectLedgerGroup.tsx` | Preserve the single project-name element and all behavior. |
| `sidebar.css` `.project-group-name` | Replace the strong token with the existing body-weight token; preserve every other declaration. |
| `work-ledger-consolidation.test.ts` | Extend the canonical source assertion to require body weight and reject the strong token. |
| `project-ledger-group-browser.test.ts` | Measure the real rendered project-name weight and capture the existing task-scoped Project-row screenshot for visual review. |
| Other browser fixtures referencing `.project-group-name` | Preserve their text, geometry, and interaction responsibilities; they consume the same production selector and need no parallel rule. |
| Spec indexes | Register this record in the July and root catalogs. |

## Implementation and verification

1. Land this Recall and call-site plan before the source change.
2. Change the canonical project-name selector to the body-weight token and add the focused regression.
3. Run the focused source test, Overlay typecheck, and required documentation-health checks.
4. Run the production Project-row browser fixture through Node, inspect the task-scoped screenshot, and correct any visual mismatch.
5. Review the final diff, commit only task-owned files, and push the current branch to git-cc.

## Progress

- [x] Inspect user evidence, prior decisions, canonical owner, tests, and remote baseline.
- [x] Record Recall, cause chain, complete call-site disposition, and verification plan.
- [x] Implement the normal project-name weight and regression coverage.
- [x] Complete source, type, documentation, browser, and visual verification.
- [x] Perform second review, commit, and push to git-cc.

## Verification record

- Passed 11 focused Work Ledger and left-rail source tests with 370 expectations.
- Passed Overlay TypeScript typecheck and Prettier formatting checks for every changed source/test file.
- Passed the Node-launched production Project-row browser fixture after a fresh production build. The fixture asserts that the canonical project-name element computes to weight 400 while preserving Project-row actions, geometry, collapse behavior, selection, and keyboard behavior.
- Manually reviewed `.scratch/project-ledger-group-work-ledger.png` and `.scratch/project-ledger-group-work-ledger-actions.png`. The project title is visibly regular weight, remains vertically aligned with the folder and action icons, fits without new clipping, and preserves the single-row hover surface.
- The user's running OpenCorvus and Overlay process was not restarted, refreshed, closed, or used as the visual target; verification ran in the isolated browser fixture selected by the Browser control workflow.
