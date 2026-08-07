# Work Ledger Task Running Spinner

## Recall

- User request: remove the grey, red, and green lamps after Task rows and reuse the existing spinning indicator only while a Task is still running.
- Acceptance: active Mission, Chat, and Task rows show the existing loading spinner; queued, completed, failed, and cancelled Task rows show no trailing lifecycle lamp; the real Overlay is opened and visually reviewed with a Task hierarchy screenshot.
- Hard constraints: preserve all parallel worktree changes; do not add, modify, update, or run User Interface (UI) automation tests; do not introduce a second status source or fallback; use the existing Work Ledger presentation status and loading icon.
- Read records: `specs/current/architecture/07-panel.md`; the August record and root spec indexes; prior Work Ledger status implementation and Cascading Style Sheets (CSS).
- Repository search: `WorkLedger.tsx` is the only Work Ledger owner of `work-row-status-mark`; `showTaskStatus` only enables that marker for Mission child Tasks; `work-row-loading-icon` already owns the spinner for active Mission and Chat rows; `StatusIndicator` remains shared by Board, Conversation, Chat Bubble, and Sub-agent surfaces and is not changed.
- Existing UI tests discovered in the touched Work Ledger surface: `work-ledger-status-hierarchy.test.ts`, `task-row-right-alignment.test.ts`, `flat-redesign-motion-coverage.test.ts`, `browser/work-ledger-status-hierarchy-browser.test.ts`, `browser/hover-action-geometry.test.ts`, and `browser/work-ledger-conversation-row-browser.test.ts`. They are retired rather than updated or run, per the repository UI automation prohibition.
- Independent agent feedback: none requested; this is one narrow component/CSS ownership change.

## Implementation

1. Make active presentation status the single condition for the existing Work Ledger spinner across Mission, Chat, and Task rows.
2. Remove the Task-only status-dot render branch, its prop plumbing, import, and dedicated layout/color CSS.
3. Retire the discovered UI automation files that encode the removed lamp layout.
4. Run formatting/type/static/document checks that do not assert rendered UI, then open the real Overlay, inspect it, capture a current Task-hierarchy screenshot, and review it manually.

## Call-site disposition

| Surface                             | Current use                                     | Disposition                                                        |
| ----------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------ |
| `WorkLedgerRow` active Mission/Chat | `work-row-loading-icon`                         | Extend unchanged spinner to active Task rows.                      |
| `WorkLedgerRow` Mission child Task  | `StatusIndicator appearance="dot"`              | Remove entirely for every lifecycle status.                        |
| `WorkLedgerTaskChildRow`            | Passes `showTaskStatus`                         | Remove obsolete prop.                                              |
| Other `StatusIndicator` consumers   | Board, Conversation, Chat Bubble, Sub-agent tab | Keep unchanged; they are outside the Work Ledger Task-row request. |

## Verification

- `bun run typecheck` in `packages/overlay`: passed.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`: passed 2/2; this is a document-health contract, not a UI test.
- `bun run docs:check`: passed.
- Real Vite Overlay at `http://localhost:5173/` connected to an isolated OpenCorvus backend at `127.0.0.1:17878`. Manual screenshot review of `Anonymous 433d45` confirmed completed and failed Task rows have no trailing lamps and retain aligned titles/actions.
- One Task in the isolated database was temporarily projected as active, then restored exactly at every inspected field. The real Work Ledger rendered exactly one loading icon, no lifecycle lamp, with computed animation `oc-spin` at `0.8s`; manual screenshot review confirmed the spinner is visible at the active Task row's trailing edge.
