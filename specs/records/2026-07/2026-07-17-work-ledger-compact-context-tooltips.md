# Work Ledger Compact Context Tooltips

Status: implemented, visually verified, and delivered to legacy remote

## Recall

| Item | Detail |
| --- | --- |
| User request | Retry the Work Ledger hover repair. A project hover must show the folder name, the aggregate Task/Chat/Mission count, and the folder path. A Task/Chat/Mission hover must show the item name on one ellipsized line, the folder name, optional Git branch only if it is already implemented, and the start time. Every absent value must be omitted rather than replaced by a label or placeholder. The user's follow-up explicitly says not to implement Git branch projection when it does not already exist. |
| Acceptance criteria | The project header no longer produces the long browser-native tooltip and opens one compact Kobalte Tooltip with folder name, non-zero aggregate Task/Chat/Mission count (including nested Mission Tasks), and path. Item rows open the existing compact Kobalte Tooltip with a one-line ellipsized real title, physical folder name, and relative start time derived from `created`; the old request description, exact/update timestamp, Task ID, project display name, full path, and unavailable branch are absent. Empty title/folder/start-time/count values produce no empty row. A real desktop browser run proves both popup structures, title overflow, missing-value omission, and screenshot quality. |
| Hard constraints | Reuse the repository Tooltip, Button, Icon, Work Ledger response, project-directory label, and relative-time primitives. Do not add branch API/schema/VCS work, use the active project's branch for unrelated rows, or fetch on hover. Delete the native project-header `title` source and the superseded item-tooltip fields/styles. Do not touch or restart the running OpenCorvus/Overlay, create a worktree, add mobile/tablet scope, or stage unrelated scrollbar/rail/shadow edits. Playwright runs through Node. Commit subjects start with `dsw-33987` and delivery pushes to `legacy-remote`. |
| Sources read | `AGENTS.md`; browser-control skill; both supplied screenshots; current `ProjectLedgerGroup.tsx`, `WorkLedger.tsx`, `work-ledger.css`, Work Ledger frontend/backend schemas and route, Project/VCS implementation, locale catalogs, focused source tests, backend route tests, and the real-browser Work Ledger fixture; prior identity/path and compact-summary records. |
| Whole-repository search evidence | `ProjectLedgerGroup.tsx` is the sole project-group owner and its main Button still sets the long concatenated native `title`; `projectLedgerGroupTip` and the optional group `title` prop have no caller. `WorkLedger.tsx` is the sole item-summary Tooltip producer and still renders description, exact/update timestamp, Task ID, project display name, and row path. `work-ledger.css` owns all corresponding obsolete selectors. `work-ledger-consolidation.test.ts` and `project-ledger-group-browser.test.ts` are the two direct Overlay regression owners. Work Ledger rows already carry canonical `title`, `directory`, `created`, and `updated`, but no branch field; per the revised user boundary, backend projection, VCS, route, and service schemas stay unchanged. |
| Independent agent feedback | None. The user did not request sub-agents, and the active collaboration policy forbids unrequested delegation. |
| Git baseline | Work started at `733b4f9e4` on `work-v0.0.8beta-yr-0717`, equal to `legacy-remote/work-v0.0.8beta-yr-0717`. Pre-existing unstaged scrollbar/rail/shadow and related browser-test/spec changes are user-owned and remain outside this delivery. |

## Causal chain

1. The oversized project popup is browser chrome, directly caused by the project header Button concatenating name, path, and count into a native `title` attribute.
2. The item popup uses the correct Tooltip primitive, but its information model still reflects superseded requirements: long request text, two timestamp forms, ID, display project name, and complete path.
3. Folder name can be derived from each row's canonical directory and start time already exists as `created`; Git branch is not present in the Work Ledger contract. Reusing the selected project's branch would mislabel other rows, while implementing a new projection is explicitly out of scope.
4. The root repair is one structured project Tooltip and one simplified item Tooltip using only already-canonical row values, with each optional visual row independently conditional.

## Call-site disposition

| Surface | Decision |
| --- | --- |
| `packages/overlay/src/components/ProjectLedgerGroup.tsx` | Replace the main Button's native `title` with one structured Kobalte Tooltip; use the physical folder name, non-zero aggregate count, and full path, each behind its own presence check. Delete the unused string-tip helper and prop. |
| `packages/overlay/src/components/WorkLedger.tsx` | Keep the existing item Tooltip, but render only a non-empty real title, physical folder name, and relative start time from `created`. Count each visible top-level item plus nested Mission Tasks for the project total. Delete description, exact/update timestamp, Task ID, project display name, path, and unavailable branch blocks. |
| `packages/overlay/src/styles/surfaces/work-ledger.css` | Share compact summary/fact-row styling across both popup types; preserve one-line ellipsis; delete superseded description/ID/project/path selectors. Preserve the unrelated unstaged `scrollbar-gutter` hunk. |
| `packages/overlay/src/i18n/{en-US,zh-CN}.json` | Add one aggregate-count label and remove the now-unused Task-ID label. Existing branch localization remains owned by `chat.git.branch` but the icon/text row does not need a visible field label. |
| Focused source and browser tests | Replace old-field expectations with exact project/item composition, branch projection, missing-value omission, absence of native title, real overflow styles, and scoped screenshots. |

## Implementation and verification plan

1. Add failing Overlay assertions for the exact popup contracts, including omission semantics.
2. Implement the two Tooltip compositions using the existing Work Ledger row contract while removing obsolete code and styles.
3. Run focused backend/Overlay tests, typecheck, internationalization, route/OpenAPI checks where required, and the Node-launched real browser fixture.
4. Inspect project and item popup screenshots at original resolution; iterate until geometry and hierarchy match the supplied compact references.
5. Run documentation health and diff checks, update this record with evidence, stage only task-owned hunks/files, commit, and push to legacy remote.

## Verification commands

```powershell
bun test packages/overlay/test/work-ledger-consolidation.test.ts
bun run --cwd packages/overlay typecheck
bun run --cwd packages/overlay check:i18n
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/project-ledger-group-browser.test.ts
bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts
git diff --check
```

## Progress

- [x] User references, previous decisions, owners, contract path, and focused tests inspected.
- [x] Regression assertions written and observed failing against the native project tooltip and old item-detail composition.
- [x] Compact project and item Tooltip implementations complete without a branch-contract expansion.
- [x] Focused, type, i18n, real-browser, and screenshot checks pass.
- [x] Documentation health checks pass after all linked record files were tracked.
- [x] Exact task-owned diff review, commit, pre-push quality hooks, and legacy remote push complete.

## Result

- The project header's native concatenated `title` string and unused title override were deleted. Hover now opens the same Kobalte Tooltip primitive used elsewhere and conditionally renders the physical folder name, aggregate Task/Chat/Mission count, and canonical path.
- The aggregate count includes every top-level Task, Chat, and Mission plus Tasks nested under a Mission. A zero count produces no count row.
- The item Tooltip now renders only the non-empty persisted title, its `created` start time in the existing relative-time format, and the physical folder name. Long titles are one line with ellipsis.
- Task request text, update/exact timestamps, Task ID, project display name, full item path, and Git branch were removed from the item popup. Branch projection was deliberately not added because the revised request explicitly excludes implementation when the Work Ledger contract lacks it.
- All optional sections are independently conditional. The read-only Tooltip content and Popper positioner remain pointer-transparent so they do not block row actions.

## Verification record

| Check | Result |
| --- | --- |
| Focused Overlay source suite | Passed: 8 tests, 313 expectations. |
| Overlay typecheck | Passed: `tsc --noEmit`. |
| Overlay internationalization | Passed: `overlay panel i18n ok (8086d1b8b04d6219)`. |
| Node-launched real desktop browser | Passed after a fresh Vite production build. It asserts the 7-item aggregate including one nested Mission Task, zero-count omission, project native-title removal, exact folder/path content, item title overflow, `created` ISO start-time ownership, absent description/ID/path/branch nodes, pointer transparency, and existing pin/action behavior. |
| Visual review | Passed at original resolution for `.scratch/work-ledger-project-compact-context-tooltip.png` and `.scratch/work-ledger-row-compact-context-tooltip.png`. The project card follows the three-row reference hierarchy; the item card is compact, its long title visibly ellipsizes, and start time stays right-aligned. |
| Diff health | `git diff --check` passed. |
| Documentation health | Passed: 81 tests and 1,282 expectations across historical links, document health, and product-document single-source checks. |
| Delivery | Task-owned hunks were reviewed before commit. Commit `3c0d7540c` was pushed to `legacy-remote/work-v0.0.8beta-yr-0717`; all pre-push checks passed (SDK imports, AI runtime, repository typecheck, route inventory, docs, Overlay internationalization, and secret scan). A concurrent process added its already-staged titlebar/conversation files during the commit's index-lock window, so the shared commit also contains that separately owned work; no reset, rewrite, or destructive separation was performed. |
