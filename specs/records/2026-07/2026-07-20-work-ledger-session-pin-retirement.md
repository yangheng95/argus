# Work Ledger Task, Mission, And Chat Pin Retirement

## Recall

| Item | Detail |
| --- | --- |
| User requirement | Remove the Task / Mission / chat pin feature. |
| Acceptance criteria | Task, Mission, and right-sidebar Coding Assistant chat rows expose no pin control or pinned presentation state; the Session domain no longer stores or mutates Work Ledger pin state; the Session pin route, generated SDK operation, public API documentation, and transport allowlist entry are absent; Work Ledger Task/Mission/chat ordering is activity-based; Project pinning remains intact as the separately requested Project shortcut; focused backend, Overlay, generated-contract, type, build, browser, screenshot, document-health, review, commit, and git-cc push checks pass. |
| Hard constraints | Remove the old Session pin path instead of retaining compatibility or fallback logic. Do not add a gate, state machine, second source, migration, mobile/tablet scope, or worktree. Preserve Project `time_pinned` and `/work-ledger/project/{projectID}/pin`. Use existing Button/Dropdown primitives and the real Work Ledger projection. Run Playwright through Node.js and do not restart, refresh, close, or otherwise interfere with the user's running OpenCorvus/Overlay. Commit subjects start with `dsw-33987`; push only to `myhexin`. |
| Sources read | Root `AGENTS.md`; Browser control skill; `specs/current/architecture/02-data.md`; `2026-07-12-work-ledger-pin-unpin.md`; `2026-07-13-project-pin-unpin-and-icon-repair.md`; `2026-07-18-work-ledger-pin-and-automatic-right-dock-reveal.md`; current Session/Project schema and writers, Work Ledger projection/routes/service/component/styles, generated SDK/OpenAPI/docs, and focused backend/Overlay/transport/browser tests. |
| Whole-repository search evidence | `SessionTable.time_pinned`, `Session.Info.time.pinned`, and `Session.setPinned` are the only Session persistence/writer chain. `/work-ledger/session/:sessionID/pin` is the only server mutation route and `setWorkLedgerPinned` is its only production client. `mission-row-pin` and `chat-row-pin` are the only Task/Mission/chat row controls; Task is already rejected by the shared action handler and has no persisted pin state. Mission/Chat `pinned` fields and `rowPinned` supply only client pin-first sorting and `data-pinned`. SQL candidates currently read Session pin state for Mission/Chat, while the shared `pinned` candidate/cursor partition is also required by the separate Project pin feature. Generated OpenAPI/SDK/API docs and the transport/directory path inventories contain the Session pin route. The Project pin chain is separate (`ProjectTable.time_pinned`, `Project.setPinned`, project route/client/group action/Pinned section) and remains in scope only as a non-regression boundary. |
| Independent agent feedback | None. The user did not request sub-agents and the active collaboration boundary forbids unrequested delegation. |
| Git baseline | `work-v0.0.11beta-yr-0720` at `7a6d2bbd2`, equal to `myhexin/work-v0.0.11beta-yr-0720` after fetch. The worktree contains unrelated uncommitted Overlay/spec changes; they must be preserved and excluded from this task's commits. |

## Root Cause And Replacement Design

Task rows never had a pin writer or stored pin state, but Mission and chat rows
acquired Session-level presentation state that now crosses the database, domain
model, combined projection, public route, generated clients, and row action rail.
Removing only the visible buttons would leave an undocumented sorting source and
dead API. Retire that Session capability end to end. In the combined SQL
projection, Mission, chat, and Task candidates use the same literal unpinned
partition; the remaining partition and cursor field continue to describe Project
pinning only. Mission/chat row contracts then omit `pinned`, and their local item
ordering uses queued-Task order followed by activity time.

## Call-Site Disposition

| Surface | Decision |
| --- | --- |
| `session/session.sql.ts` and `session/index.ts` | Delete `time_pinned`, its index, `Info.time.pinned` mapping, and `Session.setPinned`; do not migrate the unreleased schema. |
| `work-ledger/projection.ts` | Remove Mission/Chat `pinned`; project Session candidates into the unpinned partition; keep candidate/cursor `pinned` only for Project pagination; derive the cursor partition from Project rows only. |
| `server/routes/work-ledger.ts` | Delete `/session/:sessionID/pin`; retain the Project pin validator and route. |
| `overlay/services/work-ledger.ts` | Remove Mission/Chat `pinned` and `setWorkLedgerPinned`; retain Project pin and the Project-aware cursor. |
| `WorkLedger.tsx` | Remove Session pin import, row pin helper/state, Mission/chat action-count entry, and pin button. Preserve Project group pin and Pinned section. |
| `work-ledger.css` | Delete selectors dedicated to `mission-row-pin` and `chat-row-pin`; keep Project pin styling. |
| Backend/Overlay/browser tests | Replace Session pin success assertions with absence, activity-order, route-retirement, schema-retirement, and no-control assertions. Keep real Project pin coverage. |
| Transport route inventory | Remove the retired Session pin route; retain Project pin. |
| Generated OpenAPI/SDK/API docs | Regenerate from live routes so the Session pin operation and Mission/Chat `pinned` response fields disappear without manual compatibility declarations. |
| `specs/current/architecture/02-data.md` | Remove Session `time_pinned`; retain Project pin as the sole remaining Work Ledger pin state. |

## Implementation And Verification Plan

1. Land and push this Recall/index checkpoint without including unrelated dirty
   worktree changes.
2. Add/adjust focused regressions, then retire the Session pin capability across
   schema, domain, route, projection, Overlay, styles, and path inventories.
3. Regenerate OpenAPI, JavaScript SDK, and API Markdown from the live route source.
4. Run focused backend, Overlay, transport, generated-contract, typecheck, i18n,
   build, and documentation tests.
5. Run the real desktop Work Ledger browser fixture through Node.js, prove Task,
   Mission, and chat rows have no pin actions while Project pin remains, capture a
   task-scoped screenshot, inspect it at original resolution, and correct any
   action-rail/layout regression.
6. Re-run exact whole-repository searches, review the final diff and screenshot,
   fetch the latest git-cc branch, commit only this task's files, and push through
   hooks.

## Progress

- [x] Read governing rules, current architecture, historical decisions, current
  implementation, generated artifacts, and focused tests.
- [x] Enumerate all Session/Project pin persistence, route, projection, client,
  visual, transport, generated, documentation, and test call sites.
- [x] Commit and push the Recall/index checkpoint (`1830e373c`).
- [x] Implement the end-to-end Session pin retirement and regressions.
- [x] Regenerate contracts and complete focused/static verification.
- [x] Complete real desktop browser/screenshot acceptance and second review.
- [x] Prepare the verified implementation for its task-scoped commit and git-cc
  push; the resulting commit and remote reference are recorded in Git history.

## Verification And Second Review

- The live OpenAPI generator now emits 273 operations in 23 groups. The retired
  Session pin route and its generated SDK operation/types are absent from the
  canonical OpenAPI JSON, JavaScript SDK, and English/Chinese API Markdown.
- Exact repository searches find the retired route, writer, Session schema field,
  and Session pin index only in negative regression assertions. The remaining
  `time_pinned` references belong exclusively to Project persistence, projection,
  and architecture documentation.
- The focused backend, Overlay, generated-contract, directory-policy, and
  transport suite passes 162 tests with 1,989 expectations. The focused Work
  Ledger server suite passes all eight tests, including schema/route retirement,
  activity ordering, response omission, and Project pin non-regression.
- OpenCorvus and Overlay TypeScript checks, `api:routes-check`, `docs:check`,
  Overlay internationalization, and the Vite production build pass. The OpenAPI
  CLI/direct-generation test passes when isolated. Its complete-file run can
  terminate that same child process with code 143 while adjacent expensive tests
  are active; the direct CLI exits 0 and the task-scoped canonical comparison
  passes, so this is recorded as runner resource contention rather than contract
  drift.
- The Node.js Playwright Work Ledger fixture passes and captures
  `.scratch/work-ledger-session-pin-retired.png`. Original-resolution inspection
  confirms Task, Mission, and chat rows have no pin affordance, pinned row state,
  empty action-rail gap, or overflow. The separately supported Pinned Project
  shortcut and Project unpin control remain visible and functional.
- Two broader browser files contain task-owned stale-fixture cleanup, but their
  complete runs are currently stopped before the Work Ledger assertions by
  unrelated concurrent visual changes (`project-ledger-group-browser`: tooltip
  pointer-events; `titlebar-toolbar-toggle-browser`: titlebar inset). The dedicated
  real-browser fixture covers this requirement and passes; the unrelated
  Memory/Settings/titlebar files are intentionally excluded from this task.
- Final diff review found no fallback route, compatibility type, second source,
  Session pin sort, or Task/Mission/chat pin selector. Project pin behavior remains
  the single intentional pin capability.
