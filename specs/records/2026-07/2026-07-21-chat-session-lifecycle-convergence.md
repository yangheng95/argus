# Chat Session Lifecycle Convergence

## Recall

- User requirement: the Chat message surface must stop showing an execution state after the assistant response has actually finished.
- Reported session: `ses_07f5d4cadffeAfnorqA7YfBYsP`, title `重试`, directory `/Users/yangheng/Documents/OpenCorvus-Demos/crypto`, served by `http://127.0.0.1:7878`.
- Acceptance:
  - a completed/parked reusable Chat hydrates as `idle`, not `active`;
  - an in-flight Chat hydrates and updates live as `active`;
  - a terminal Chat hydrates and updates live as `terminal`;
  - the Work Ledger row, session board envelope, and Agent Rail session projection agree;
  - tests cover hydrate plus live lifecycle mutation, and the real reported session is visually rechecked with a Node Playwright sidecar without restarting the user's running OpenCorvus process.
- Hard constraints: one lifecycle source; no fallback, gate, compatibility branch, state machine, temporary iframe, or process restart; preserve unrelated Visual QA worktree edits; use the Browser skill and screenshot review for frontend acceptance.
- Baseline: `d95ea2ac4` on `v0.0.12beta`, already equal to `legacy-remote/v0.0.12beta` when investigation began.
- Existing unrelated edits observed and excluded from this work: `packages/opencorvus/src/orchestrator/visual-qa-stage.ts`, `packages/opencorvus/src/tool/task-tool-execution-scope.ts`, `packages/opencorvus/src/visual-qa/**`, and their Visual QA tests/fixtures.
- Read architecture and records: `specs/current/architecture/07-panel-reactivity.md`, `specs/records/2026-07/2026-07-21-chat-message-scroll-repair.md`, `packages/opencorvus/src/session/status.ts`, `packages/opencorvus/src/session/lifecycle.ts`, `packages/opencorvus/src/protocol/session-mirror.ts`, `packages/opencorvus/src/conversation/view.ts`, and the session route/Overlay hydrate/writer paths listed below.
- Full-repository grep covered `SessionConversationHydration`, `SessionBoardEnvelope`, `resolveSessionLifecycle`, `SessionStatus.get`, `listConversationAgentSessionsForSessionTree`, `session.status`, `session.idle`, `sessionBoard`, `selectedTaskStatus`, `board.status`, and every literal `status: "active"` in the server, Overlay services/components, and relevant tests.
- Independent Agent feedback: none; the user did not request delegation, so no sub-Agent was started.

## Evidence and causal chain

The exact persisted assistant message has `time.completed=1784599778862`, a `step-finish` part with `reason=stop`, and no error. The Work Ledger API reports the same session as `idle`. In contrast, `GET /session/:sessionID/conversation` returns `board.status="active"`, and `agentView.sessions[0].status="pending"`. A read-only SQLite query found no durable `session.status`, `session.idle`, or `session.error` rows for the reported session. The first isolated-browser reproduction then exposed the remaining visible contradiction: Work Ledger and Agent Rail both rendered `Idle`, while the latest assistant card still rendered `Running` with a cancel action.

The observable defect therefore has three direct triggers:

1. `packages/opencorvus/src/server/routes/session.ts` synthesizes every unarchived session board as `active`, ignoring `resolveSessionLifecycle`.
2. The session route passes a root Agent Rail ledger entry that only contains durable `session.status` protocol evidence. Standalone assistant-session mirroring is explicitly ephemeral, so after hydration/restart a completed reusable Chat has no durable row and remains `pending` forever.
3. `packages/overlay/src/services/tree-writer.ts::hydrateConversationView` reads `assistant.time.completed` into message metadata but never projects it onto the card. Both hydrate and live `message.updated` therefore leave the card at its construction default, `running`, unless a separate lifecycle event happens to arrive.

The deeper cause is duplicated status ownership. `SessionStatus` / `resolveSessionLifecycle` already define the lifecycle truth, but Work Ledger, session-board hydration, and Agent Rail hydration each project it differently. The previous path could not converge because live `session.status` updated cards only and never updated the selected session board envelope.

## Exhaustive call-point disposition

| Call point | Current role | Disposition |
| --- | --- | --- |
| `session/lifecycle.ts::resolveSessionLifecycle` | process latch plus latest durable lifecycle | retain as authoritative source; add the shared `active/idle/terminal` projection |
| `work-ledger/projection.ts::chatStatus` | maps only `SessionStatus.get` | replace with the shared lifecycle projection |
| `server/routes/session.ts::/:sessionID/conversation` | hardcodes unarchived session to `active` | replace with the shared lifecycle projection; preserve explicit `archived` ownership |
| `orchestrator/task-event.ts::listConversationAgentSessionsForSessionTree` | SQL-selects durable child execution status for Task/Agent semantics | retain; newly created child executions without status must remain `pending` |
| `server/routes/session.ts` root Agent Rail projection | passes the standalone root through the durable child ledger contract | replace only the requested root row with `resolveSessionLifecycleSnapshot`; preserve child execution semantics |
| `conversation/view.ts::applyLedgerLatestStatus` | maps hydrated ledger lifecycle into Agent Rail status | retain; it will receive an authoritative lifecycle for every session |
| `overlay/services/conversation.ts::hydrateConversation` | installs the backend board and Agent view | retain; corrected backend payload is its single hydrate source |
| `overlay/services/tree-writer.ts::handleSessionStatus` | updates the active message card only | also update the currently selected matching session board status from the same event |
| `overlay/services/tree-writer.ts::handleMessageUpdated` and `hydrateConversationView` | compute persisted message completion but only project errors | project assistant completion/error through one shared message-settlement function for live and hydrate paths |
| `overlay/components/Conversation.tsx::selectedTaskStatus` | reads session board but defaults missing status to `active` | remove the active default so absence cannot fabricate execution |
| `overlay/services/chat.ts::ensureTaskListEntry` | task-list optimistic entry, not session lifecycle | retain unchanged |

## Implementation and verification

1. Write failing backend route/ledger tests and Overlay live-event tests.
2. Centralize the three-state Chat activity projection beside `resolveSessionLifecycle`, then replace every parallel session Chat projection listed above.
3. Run focused Bun tests for session conversation routes, Work Ledger, conversation hydrate/replay, tree writer, and status labels; run package typechecks and document-health/link tests.
4. Build the Overlay and use an isolated copied-database backend plus the in-app Browser/Playwright surface to capture and inspect the reported session. Acceptance requires Work Ledger `Idle`, Agent Rail `Idle`, latest assistant card `Completed`, an 11-second persisted duration, and no cancel action. Do not restart or refresh the user's running OpenCorvus window.
5. Perform a second diff review, commit with the `dsw-33987` prefix, and push `v0.0.12beta` to `legacy-remote` after hooks pass.

## Verification evidence

- Exact copied production database plus current backend at isolated port `7889`: `board.status=idle` and root `agentView.status=idle` for `ses_07f5d4cadffeAfnorqA7YfBYsP`.
- Browser/Playwright visual review of the current production Overlay build: the Work Ledger row reads `Idle`, Agent Rail reads `chat · Idle · 你好`, the latest assistant card shows the completed green indicator and persisted `11s` duration, and the running-only cancel action is absent. The older aborted turn remains an error, proving the repair does not erase historical failures.
- Focused backend/Overlay regression: 55 relevant tests passed, including completed live message settlement, completed hydrate settlement, session board live lifecycle, session conversation hydrate, Agent Rail, Work Ledger, and durable child-session status.
- Package checks completed before unrelated concurrent coordination edits advanced: OpenCorvus and Overlay TypeScript checks passed; Overlay production build passed; historical-doc links and document-health passed (82 tests); Overlay i18n passed in the earlier push hook.
- A later broad rerun exposed concurrent uncommitted coordination work outside this repair: `agent/runner.ts` and `engine/describe.ts` TypeScript failures plus A2A ownership tests in `engine/agent-coordination.ts`. Those files are not part of this repair and are preserved rather than folded into the Chat lifecycle change.
