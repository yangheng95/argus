# Work Ledger Mission / Chat Pin and Unpin

## Recall

- User request: OpenCorvus lacks pin and unpin; after clarification, both Mission and Coding Assistant chat rows must support it.
- Acceptance criteria:
  - Mission and right-sidebar Coding Assistant chat rows expose persistent pin/unpin actions.
  - Pinned Mission/chat rows sort before unpinned rows; each partition retains descending recent-activity order.
  - Project and Task rows are not pinnable.
  - The canonical Work Ledger response carries pin state and pagination does not duplicate or omit rows across the pinned boundary.
  - Actions update through one Session-domain writer, emit the existing visible Session update event, and survive reload.
  - English and Chinese labels, keyboard-focusable mature button primitives, focused backend/frontend tests, generated API/docs checks, a real isolated Overlay screenshot, and a second manual review all pass.
- Hard constraints: no fallback or compatibility path; no database migration (the unreleased database schema is rebuilt directly); no second pin source; no state machine/gate; no interference with a running OpenCorvus/overlay process; preserve unrelated dirty changes; use Node rather than Bun for Playwright; commit subject starts with `dsw-33987` and push to `myhexin` only after verification.
- Sources read: `AGENTS.md`, the user-opened untracked product-roadmap draft (not adopted as a repository dependency), `specs/current/architecture/02-data.md`, `specs/README.md`, `specs/records/2026-07/README.md`, `packages/opencorvus/src/session/{session.sql.ts,index.ts}`, `packages/opencorvus/src/work-ledger/projection.ts`, `packages/opencorvus/src/server/routes/work-ledger.ts`, `packages/overlay/src/{services/work-ledger.ts,components/WorkLedger.tsx,main.tsx}`, and related Work Ledger tests.
- Whole-repository search evidence: searches for `pin|unpin|pinned|置顶|取消置顶` found no product pin persistence or action. Existing `work_ledger.pinned` is only the static current-project section. Searches for Work Ledger schemas/routes/types/callers identify the server route registration, projection, Overlay service, WorkLedger component, main action wiring, command palette consumer, SSE refresh, and backend/frontend tests.
- Independent agent feedback: none; the user did not request sub-agents and the active multi-agent policy forbids spawning them otherwise.

## Root cause and design

Mission and Coding Assistant chat top-level rows are both durable `session` records and are unified only at the Work Ledger projection. The missing capability is therefore a Session-domain persistence and mutation contract, not two unrelated UI flags.

Add nullable `session.time_pinned` as the sole pin source. A non-null timestamp means pinned. The Work Ledger mutation accepts only a Mission or right-sidebar Coding Assistant session and delegates to the Session writer. The list projects `pinned` only on Mission/chat rows and orders all top-level rows by pin partition, then `updated DESC`, then row key. Cursor identity includes the pin partition so pagination follows the exact SQL order.

## Call-site disposition

| Surface                             | Disposition                                                                                                                                                                            |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session/session.sql.ts`            | Add canonical nullable `time_pinned` and list index.                                                                                                                                   |
| `session/index.ts`                  | Project field through `Session.Info`; add the only writer for pin/unpin and publish `Session.Event.Updated`.                                                                           |
| `work-ledger/projection.ts`         | Project `pinned`, sort/paginate by pin partition and activity; Mission/chat only.                                                                                                      |
| `server/routes/work-ledger.ts`      | Add typed pin mutation for canonical Work Ledger rows.                                                                                                                                 |
| generated OpenAPI/SDK and API docs  | Regenerate from the real route contract.                                                                                                                                               |
| `overlay/services/work-ledger.ts`   | Mirror response/cursor and expose one mutation client.                                                                                                                                 |
| `overlay/components/WorkLedger.tsx` | Render pin/unpin action with existing Button/Icon primitives and pinned affordance.                                                                                                    |
| `overlay/components/WorkLedger.tsx` | Invoke the single Work Ledger service action and refresh through the component's existing canonical reload path.                                                                       |
| command palette                     | Retain response compatibility; no separate sorting or pin store.                                                                                                                       |
| backend and Overlay tests           | Cover valid Mission/chat, persistence without activity-time mutation, ordering, cursor boundary, API request shape, UI action, keyboard access, labels, and visible pinned affordance. |

## Benchmark

- Input: mixed projects, tasks, Mission sessions, and right-sidebar Coding Assistant sessions with pinned and unpinned records.
- Output: durable pin toggles and a Work Ledger ordered exactly by pin partition then recent activity.
- Environment: current Windows host workspace and bundled repository dependencies; isolated test databases and isolated Vite/browser target only.
- Timeout: test/browser wrappers use inactivity-based timeout evidence; no wall-clock timeout beginning at process start.
- Pass: focused server/projection/Overlay suites, typecheck, API route/OpenAPI/docs checks, spec health tests, build, isolated rendered screenshot inspection, and final diff review all succeed without fallback.

## Progress

- [x] Recall and whole-repository call-site inventory.
- [x] Backend schema, writer, projection, route, and tests.
- [x] Generated contract/docs synchronization.
- [x] Overlay service, action, i18n, styling, and tests.
- [x] Focused and repository-level verification.
- [x] Isolated real-page screenshot and visual correction (the first screenshot exposed a 0px pin marker; corrected to a visible 10px accent marker and re-reviewed).
- [x] Final manual implementation review.
- [ ] Commit and git-cc push (blocked because core touched files already contain unrelated user changes; committing whole files would violate ownership preservation).

## Codex review feedback — 2026-07-13

The user rejected two assumptions in this plan after inspecting the rendered product. Excluding Project rows made the visible `Pinned` project shortcut impossible to unpin, while the added 10px row-leading pin duplicated the real hover action and looked like an ad-hoc icon. Those are not accepted variances. The corrective design and verification record is `2026-07-13-project-pin-unpin-and-icon-repair.md`; it replaces the static shortcut with canonical Project pin state and deletes the duplicate row marker.
