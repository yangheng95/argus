# Project, Goal, And Requirement Progressive Lists

Date: 2026-07-30
Status: Delivered
Owner: Codex

## Glossary

- UI: User Interface, the visible application surface.
- CSS: Cascading Style Sheets, the browser presentation language.
- API: Application Programming Interface, the backend data contract.

## Recall

| Item                       | Evidence and requirement                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User requirement           | Project, Goal, and Requirement lists must stop rendering an unbounded first view. When a list contains more than ten entries, render the first ten and place the low-emphasis `展开显示` action from the fourth supplied reference beneath the list.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Supplied evidence          | The first screenshot shows more than ten project groups in the left Work Ledger. The second screenshot shows the compact Goals workbench. The third screenshot shows thirteen Requirements. The fourth screenshot was inspected at original resolution and shows a plain gray text action directly after the preceding content, without card chrome or a hand-drawn icon.                                                                                                                                                                                                                                                                                                   |
| Acceptance criteria        | Each affected ordered collection renders all entries when its length is at most ten. Above ten entries it initially renders exactly the first ten and one shared `展开显示` button. Activating the button reveals the complete existing ordered collection and changes the action to `收起`; activating it again restores the first ten. The action is keyboard accessible and uses the canonical Button primitive. Pinned projects remain visible independently; only the ordinary by-project collection is progressively disclosed. Existing backend pagination remains a separate `加载更多` operation.                                                                  |
| Hard constraints           | Implement one shared progressive-list abstraction and one localization pair; do not duplicate slicing/state/button logic across surfaces. Preserve current ordering, project pinning, project-group collapse, Goal and Requirement item disclosure state, backend pagination, empty/loading/error behavior, and all unrelated shared-worktree changes. Do not add a route, renderer, fallback, compatibility path, workflow gate, iframe, query override, mobile scope, hand-written icon, or UI automated test. Do not add, modify, update, delete, or run UI automated tests. Real-page verification uses Node-based Browser tooling and personally reviewed screenshots. |
| Sources read               | Root `AGENTS.md`; Browser control skill; all four user screenshots; `specs/current/architecture/07-panel.md`; the current Right Dock Goal/Requirement disclosure record; current `WorkLedger.tsx`, `LedgerList.tsx`, `ProjectLedgerGroup.tsx`, `Board.tsx`, `GoalGroup.tsx`, `RequirementsPanel.tsx`, Button primitive, locale catalogs, and relevant Work Ledger/sidebar/inspector CSS.                                                                                                                                                                                                                                                                                    |
| Whole-repository grep      | `GoalList` is mounted only by `GoalsBoardPanel`; `RequirementsPanel` is mounted only by `RequirementsBoardPanel`; `LedgerList` is mounted only by `WorkLedger`. Work Ledger has separate pinned and unpinned group projections, plus a one-list projection containing one synthetic group. The existing `加载更多` action calls backend pagination and cannot own local ten-entry disclosure. No shared progressive-list primitive exists. `ConversationArtifactSummary` has feature-local show-more logic for artifact files and is not a general ordered-list owner.                                                                                                      |
| Independent agent feedback | No sub-agent was started because the current collaboration instruction permits delegation only when the user explicitly requests it; this request did not. Codex will perform the required second source, interaction, and visual review directly.                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Git baseline               | Delivery branch is `work-v0.0.24beta-yr-0729`, tracking `myhexin/work-v0.0.24beta-yr-0729`. The worktree already contains the in-progress Goal/Requirement disclosure and Right Dock stability changes from the immediately preceding plans. This task must preserve and verify them rather than overwrite them.                                                                                                                                                                                                                                                                                                                                                            |

## Complete Call-Site Disposition

| Owner or consumer                          | Current evidence                                                                                      | Disposition                                                                                                                                                                  |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New shared progressive-list component      | No canonical owner exists.                                                                            | Own the ten-entry presentation limit, local expanded state, ordered slicing, canonical Button, localization labels, and data attributes once.                                |
| `GoalGroup.tsx::GoalList`                  | Sole Goal list renderer over the canonical board ordering.                                            | Replace the direct `For` with the shared progressive list; preserve every `GoalGroup` identity and item disclosure state.                                                    |
| `RequirementsPanel.tsx`                    | Sole Requirement list renderer over the canonical board ordering.                                     | Replace the direct `For` with the shared progressive list; preserve indices from the complete source order and every Requirement disclosure state.                           |
| `LedgerList.tsx`                           | Sole loading/error/empty/list shell, currently used only by Work Ledger.                              | Add optional composition with the shared progressive list while keeping loading, error, empty, and retry ownership unchanged.                                                |
| `WorkLedger.tsx` pinned project collection | Pinned groups render in a dedicated section before the Projects toolbar.                              | Preserve as always visible so pinning remains an explicit visibility promise.                                                                                                |
| `WorkLedger.tsx` ordinary collection       | By-project mode passes all unpinned groups to `LedgerList`; one-list mode passes one synthetic group. | Opt this list into the shared ten-entry presentation. By-project mode limits project groups; one-list mode naturally remains unchanged because its collection length is one. |
| `WorkLedger.tsx` backend pagination        | `nextCursor` drives a separate `加载更多` button and page request.                                    | Preserve unchanged. Local expansion reveals already loaded project groups; backend loading remains explicit and authoritative.                                               |
| Locale catalogs                            | No generic labels match the requested wording.                                                        | Add one shared expand/collapse pair in both Chinese and English catalogs.                                                                                                    |
| Shared and surface CSS                     | No shared progressive-list action style exists.                                                       | Add one primitive action style and only minimal surface-specific alignment where the left rail requires it.                                                                  |
| Existing UI tests                          | Source-string, DOM, browser, and screenshot tests assert UI behavior.                                 | Leave untouched and unrun under the project-wide UI automated-test prohibition.                                                                                              |

## Implementation Plan

1. Add one generic Solid progressive-list component using the existing Button
   primitive, a single ten-entry default, and localized expand/collapse labels.
2. Compose Goals and Requirements through the shared component while preserving
   their current item-level disclosures and canonical source indices.
3. Let the existing Ledger list shell opt into the same component, then enable
   it for the ordinary Work Ledger collection only.
4. Add the restrained text-action styling seen in the fourth reference and
   update current architecture ownership.
5. Run formatting checks, Overlay typecheck, localization check, production
   build, and documentation health checks. Do not run UI automated tests.
6. Start the real current-source desktop page, inspect the three threshold
   states, activate expand/collapse through the native Button, and personally
   review task-scoped screenshots.
7. Perform a second diff and ownership review, update this record with exact
   verification evidence, commit, fetch/reconcile the shared branch, and push to
   `myhexin`.

## Status

- [x] User evidence, repository state, historical decisions, and complete production/test call points inspected.
- [x] Plan and Recall written before implementation.
- [x] Plan committed and present on `myhexin` before implementation.
- [x] Shared component and three surface compositions implemented.
- [x] Static verification and real-page visual review complete.
- [x] Second source, ownership, and visual review complete.
- [x] Final implementation commit `bc886939ae` pushed to `myhexin`.

## Verification

- `bun run --cwd packages/overlay typecheck` passed.
- `bun run --cwd packages/overlay check:i18n` passed with the Chinese
  `展开显示` / `收起` pair and the English `Show more` / `Show less` pair.
- `bun run --cwd packages/overlay build:vite` passed. Vite reported only the
  repository's existing dependency-directive and chunk-size warnings.
- `git diff --check` passed.
- Documentation health passed:
  `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`,
  `bun test packages/opencorvus/test/script/product-docs-single-source.test.ts`,
  and `bun test packages/opencorvus/test/script/document-health.test.ts`.
- No UI automated test was added, changed, updated, deleted, or run.
- The real current-source page at `http://127.0.0.1:5173/` loaded the real
  Phase 02 board from the local OpenCorvus server. Direct board evidence
  established six Goals and thirteen Requirements; the real Work Ledger
  contained fifteen ordinary unpinned project groups.
- Work Ledger inspection showed ten project groups before expansion and all
  fifteen after activating the action. Visual evidence:
  [`2026-07-30-project-progressive-list-collapsed.png`](../../artifacts/2026-07-30-project-progressive-list-collapsed.png)
  and
  [`2026-07-30-project-progressive-list-button.png`](../../artifacts/2026-07-30-project-progressive-list-button.png).
- Goals inspection showed all six Goal disclosures and no progressive-list
  action, proving the at-most-ten path:
  [`2026-07-30-goals-progressive-list-under-threshold.png`](../../artifacts/2026-07-30-goals-progressive-list-under-threshold.png).
- Requirements inspection showed exactly REQ 01 through REQ 10 with one
  low-emphasis action; activating it revealed REQ 11 through REQ 13 and changed
  the action to the collapse label. Visual evidence:
  [`2026-07-30-requirements-progressive-list-collapsed.png`](../../artifacts/2026-07-30-requirements-progressive-list-collapsed.png)
  and
  [`2026-07-30-requirements-progressive-list-expanded.png`](../../artifacts/2026-07-30-requirements-progressive-list-expanded.png).
- Manual visual review confirmed the action sits immediately after the loaded
  list, uses the existing Button focus treatment, and remains a restrained text
  control without card chrome or a new icon. The project, Goal, and Requirement
  ordering and item-level disclosure affordances remained intact.
