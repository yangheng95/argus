# Ledger Loading Status Live

Date: 2026-06-19

GUI means Graphical User Interface. ARIA means Accessible Rich Internet
Applications. CSS means Cascading Style Sheets.

## Problem

Independent GUI review found `LedgerList` rendered loading as only an
`aria-hidden` skeleton. Mission and Coding Assistant users could see loading
rows, but assistive technology users received no loading status. A follow-up
sweep found TaskList had a parallel `task-list-skeleton` with the same
decorative-only semantics.

## Recall

| Source                                              | Relevant constraint                                                                                      |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `2026-06-19-browser-preview-loading-status-live.md` | Loading surfaces that own loading text use `role="status"` and `aria-live="polite"`.                     |
| `2026-06-19-workflow-generating-status-live.md`     | Generating/loading indicators use `role="status" aria-live="polite" aria-busy="true"`.                   |
| `2026-06-19-ledger-row-main-button-primitive.md`    | Task, Mission, and Coding Assistant ledgers should share row primitives instead of drifting per surface. |
| `packages/overlay/src/components/LedgerList.tsx`    | Mission and Coding Assistant already share a ledger list primitive.                                      |
| `packages/overlay/src/components/TaskList.tsx`      | Task loading kept a separate skeleton implementation.                                                    |

## Evidence Sweep

| Sweep                         | Finding                                                                           | Decision                                                                                   |
| ----------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `rg -n '<LedgerList           | LedgerList\\b                                                                     | ledger-skeleton                                                                            | task-list-skeleton' packages/overlay/src packages/overlay/test`                                                          | `LedgerList` serves Mission and Coding Assistant; TaskList has a separate skeleton. | Fix the shared primitive and route TaskList through it. |
| `rg -n 'role="status"         | aria-live="polite"                                                                | aria-busy="true"' packages/overlay/src/components packages/overlay/test specs/new-arch`    | Browser Preview, workflow generating panels, Trace, connection, and provider surfaces already use live status contracts. | Reuse the established `role="status" aria-live="polite" aria-busy="true"` contract. |
| `git diff -- MissionList.tsx` | MissionList already has unrelated mission-download edits in the current worktree. | Work with the current file, but commit only the loading-label delta via a temporary index. |

## Fix

1. Add `LedgerLoadingStatus` in `LedgerList.tsx`.
2. Keep visual skeleton rows decorative with `aria-hidden="true"`.
3. Expose one hidden but readable `ledger-loading-label` inside a
   `role="status" aria-live="polite" aria-busy="true"` container.
4. Make `LedgerList` require a `loadingLabel` so callers cannot create silent
   loading states.
5. Route TaskList's previous `task-list-skeleton` through the same component.
6. Reuse existing `common.loading` i18n text rather than introducing a new
   per-ledger string source.

## Acceptance

- Task, Mission, and Coding Assistant loading ledgers expose exactly one live
  status in their active list container.
- Skeleton rows remain visible and decorative.
- Browser screenshots verify the three loading states do not visually regress.
- Static tests prevent reintroducing `aria-hidden` as the only loading state.
