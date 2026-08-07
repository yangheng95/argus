# Codex Task Header And Work Ledger Actions

## Recall

| Item                             | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User requirement                 | Match the supplied Codex desktop header and rounded conversation frame; show the selected item title with an ellipsis menu containing only Pin, Archive, and Rename; restore the left Work Ledger pin icon; hide the row rename button and rename by double-clicking the row instead.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Acceptance criteria              | The desktop Conversation is a rounded inset surface on the ambient Workbench canvas; the selected Task, Mission, Chat, or Work title is visible in its header beside one mature ellipsis-menu trigger; the menu contains exactly pin/unpin, archive, and rename actions; the left Work Ledger exposes one pin/unpin icon action and no pencil action; double-clicking a row invokes the same rename owner; pin state persists, sorts every pinned item before unpinned items, and paginates without duplicates or omissions; title-menu and row actions share the same backend writers and refresh path; focused non-UI contracts, typecheck, build, real-page interaction, screenshots, and a second review pass.                                                                                                                             |
| Hard constraints                 | Desktop-only scope; use the existing Kobalte `DropdownMenu`, `Button`, `Icon`, Dialog, Work Ledger projection, and archive/rename services; do not add fallback, compatibility, local shadow pin state, a second list renderer, a state machine, gate, handwritten SVG, mobile/tablet behavior, UI automation test, UI source-string assertion, fixture, screenshot baseline, or pixel assertion; no database migration for the unreleased schema; use Node for browser control; do not restart or modify the user's running packaged OpenCorvus process; preserve and exclude unrelated concurrent changes; commit subjects start with `dsw-33987` and push to `legacy-remote`.                                                                                                                                                                     |
| Supplied evidence                | `codex-clipboard-894688a9-5c04-4af2-b304-6c8bfd6c586d.png` shows a Codex task header and an inset white rounded conversation frame on a pale ambient canvas. `codex-clipboard-3b4ebb6a-4cab-4381-8354-30f2e8dad36c.png` shows the three-item Pin/Rename/Archive title menu. Both originals were inspected.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Baseline evidence                | The isolated real Vite page at `http://127.0.0.1:5192/` shows the Conversation filling the Workbench edge-to-edge, a visually empty home header, and row hover rails with Rename and Archive but no item Pin. The DOM confirms every visible Chat/Work row has separate Rename and Archive buttons.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Sources read                     | Root `AGENTS.md`; Browser control skill; `specs/current/architecture/{02-data,07-panel,99-principles}.md`; the 2026-07-12 Session pin plan, 2026-07-13 Project pin correction, 2026-07-16 pin visual refinement, 2026-07-20 Session pin retirement, 2026-07-21 right-edge alignment, 2026-07-28 Work conversation, and 2026-07-29 workspace-corner records; current App, WorkLedger, ProjectLedgerGroup, DropdownMenu/Button/Icon primitives, title/header/conversation/workspace/work-ledger styles, Work Ledger service/projection/routes/transport schema, Task/Session persistence and writers, title/archive/rename routes and clients, i18n, generated contract owners, and focused non-UI tests.                                                                                                                                        |
| Whole-repository search evidence | `App.tsx` is the sole Conversation header/frame renderer. `main.tsx` is the sole active-selection title projection and owns all Mission/Task/Chat rename/archive actions. `WorkLedger.tsx` is the sole mixed-item row/action renderer. `ProjectLedgerGroup.tsx` is the only current pin-menu reference. `work-ledger/projection.ts` is the sole mixed ordering/cursor projection and currently hard-codes Mission/Chat/Task candidates to unpinned. `ProjectTable.time_pinned` plus `Project.setPinned` is the only surviving pin persistence. `SessionTable` and `EngineTaskTable` have archive but no pin field. `/work-ledger/project/:projectID/pin` is the only pin route. `services/work-ledger.ts` is the only Overlay pin client. `Session.Event.Updated` and existing Task protocol events are the canonical visible refresh sources. |
| Independent agent feedback       | None. The user did not request sub-agents, so no delegation was started.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Git baseline                     | The branch advanced concurrently while this task was investigating. Unrelated streaming-text, Right Dock, Settings Memory, spec-index, and `messages.css` work is preserved and excluded from this task.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

## Cause Chain

1. The Conversation header title is mutated imperatively through
   `#chatViewTitle`; its component owns only a usage Tooltip and has no item
   command menu, so the selected identity and actions cannot form one component.
2. `.chat` is explicitly borderless, radius-zero, and full-bleed while
   `.workspace-main` is the only ambient macro frame. The missing Codex inset is
   therefore a Conversation-surface geometry gap, not a theme-color defect.
3. Work Ledger rows already centralize rename/archive behavior, but their action
   rail renders a pencil button and has no item pin action. The row main button
   handles only single-click selection, so double-click cannot reach the shared
   rename owner.
4. The combined Work Ledger SQL already carries a pin partition for Projects,
   but Mission, Chat, and Task candidates are literal zero and their response
   schemas omit pin state. A UI-only pin icon would therefore be non-persistent
   and would contradict pagination.
5. The root repair is one persisted `time_pinned` field per durable item table,
   one typed Work Ledger item mutation, one combined projection/cursor order,
   one Overlay action owner shared by row/header, and one component-owned header.

## Complete Call-Site Disposition

| Owner / consumer                                                       | Decision                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session/session.sql.ts`, `session/index.ts`                           | Add nullable `time_pinned`, project it through `Session.Info`, and restore one Session-domain writer that publishes `Session.Event.Updated` without changing activity time. Mission and right-sidebar Chat/Work share this source.        |
| `engine/engine.sql.ts`, Engine Task writer/service                     | Add nullable `time_pinned` and one Task-domain writer that emits the existing Task update fact without changing activity time.                                                                                                            |
| `work-ledger/projection.ts`                                            | Read real pin state for Mission, Chat, and Task candidates; include `pinned` on all item rows; order and paginate by pin partition, then activity, then row key; keep Project pin ownership unchanged.                                    |
| `transport-protocol/src/index.ts`                                      | Add required `pinned` to Mission/Chat/Task rows so every visible item has one strict state.                                                                                                                                               |
| `server/routes/work-ledger.ts`                                         | Add one typed item pin route discriminated by `mission`, `chat`, or `task`; delegate to the owning writer and reject kind/identity mismatch. Retain the Project route.                                                                    |
| Generated OpenAPI, JavaScript SDK, API Markdown, and route inventories | Regenerate from the live route/schema; do not hand-author compatibility declarations.                                                                                                                                                     |
| `overlay/services/work-ledger.ts`                                      | Parse required item pin state and expose the one item mutation client.                                                                                                                                                                    |
| `WorkLedger.tsx`                                                       | Add the pin/unpin icon action; delete the pencil action; double-click the existing main button to call the same rename callback; keep selection on single click and preserve start/stop/download/archive behavior.                        |
| `main.tsx`                                                             | Centralize selected-item lookup/action dispatch so Work Ledger rows and the header menu reuse rename/archive/pin writers; replace imperative title mutation/debug-copy double-click ownership with declarative title/action props.        |
| `App.tsx`                                                              | Make the title a real component with the selected icon/title/status and a Kobalte ellipsis menu containing exactly pin/unpin, rename, and archive. Hide the menu when no durable item is selected.                                        |
| `header.css`, `conversation.css`, `workspace.css`, `work-ledger.css`   | Create the Codex-like inset rounded Conversation surface with existing radius/theme tokens, style the compact title menu, add pin action state, and remove obsolete rename-action geometry without creating a second color/radius source. |
| i18n                                                                   | Reuse existing pin/unpin, rename, and archive labels where exact; add only missing title-menu labels in English and Chinese.                                                                                                              |
| `02-data.md`, `07-panel.md`                                            | Replace the old Project-only pin statement with the new per-domain single sources and document header/row interaction ownership.                                                                                                          |
| Non-UI tests                                                           | Cover schema/writer persistence, no activity-time mutation, valid and invalid route identities, strict projection fields, pin-first ordering, cursor boundary, and Overlay request shape.                                                 |
| Existing/new UI tests                                                  | Do not add, modify, update, delete, or run them. UI acceptance is real-page interaction plus personally inspected screenshots only.                                                                                                       |

## Implementation And Verification Plan

1. Land this Recall and indexes, then implement persistence, writers, strict
   transport, route, projection, and Overlay client with focused non-UI tests.
2. Refactor the selected title/actions into one declarative header component and
   update the sole Work Ledger row renderer for pin plus double-click rename.
3. Apply the Codex inset frame and compact menu through existing design tokens.
4. Regenerate canonical API/SDK/docs artifacts and run focused non-UI tests,
   Overlay/OpenCorvus typechecks, i18n, route/docs checks, and production build.
5. Reload the isolated Node-started real page, select a real item, exercise the
   title menu, row pin, and double-click rename paths, capture current-goal
   desktop screenshots, and personally inspect header, menu, frame, and left
   action geometry. Iterate until visually aligned.
6. Re-grep every owner, review the exact diff and screenshot a second time,
   fetch/converge the current branch, commit only task-owned files with
   `dsw-33987`, and push to `legacy-remote`.

## Progress

- [x] Inspect supplied evidence, current page, historical decisions, production owners, all call sites, and git baseline.
- [x] Record the Recall, cause chain, complete call-site disposition, and verification plan.
- [x] Implement persistence, route, projection, client, and focused non-UI contracts.
- [x] Implement header, frame, row pin, and double-click rename.
- [x] Complete real-page interaction, screenshot inspection, and visual corrections.
- [x] Complete non-UI verification, regeneration, and second review.
- [x] Create the exact task-owned commit and push it to legacy remote.

## Verification Evidence

- The Work Ledger route/service and strict response contracts pass focused
  non-UI tests, including Mission/Task/Chat persistence, invalid session-kind
  rejection, pin-first ordering, cursor partition, and preservation of
  `time_updated`.
- OpenCorvus, transport-protocol, and Overlay package typechecks pass. The
  production Overlay build completes.
- A portable isolated backend at `http://127.0.0.1:7891` and its real built UI
  were used for manual desktop acceptance. The screenshots show the pale
  ambient gutter, white rounded Conversation surface, selected title plus
  ellipsis, and the three-item menu. The DOM and live interactions confirm that
  the left row exposes Pin and Archive but no Rename button, the header Pin
  changes to Unpin after persistence, and row double-click opens the existing
  Rename Chat dialog.
- The first whole-repository typecheck attempt reached the real checker but was
  temporarily blocked by concurrent Browser-tab edits. After those edits
  converged, the Overlay package typecheck passed. An unrelated transport
  native-browser command fixture remained stale during the initial combined
  test invocation; the Work Ledger contract was rerun by exact test name and
  passed.
- The final root typecheck completed with all eight package tasks successful;
  `api:routes-check`, Overlay i18n, API documentation generation, and the
  production Overlay build also passed.
- With the task-owned alternate index, the historical-links,
  product-documentation single-source, and document-health suites completed
  with 93 passing tests and zero failures. Two exited visual-preview source
  snapshots that had made the first scan fail were moved out of `.scratch`
  without deleting their recoverable contents, then the exact suite passed.
