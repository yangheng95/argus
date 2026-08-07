# Chat Mission Receipt Participant Identity Repair

## Recall

### User request

- Investigate why a Chat under the Prism project does not open, assess the impact, obtain an independent Agent review, and implement the reviewed root fix.

### Acceptance criteria

1. A right-sidebar Chat containing a truthful terminal Mission receipt hydrates through `GET /session/:sessionID/conversation` with HTTP 200.
2. The Chat remains the stable session owner (`sessionAgentID=chat`) while the receipt remains a truthful Mission participant (`agentID=mission`, `author=mission`).
3. Cross-session participation is allowed only when the persisted receipt part and the referenced Mission caller metadata prove the exact relationship; unrelated `chat -> coding` or other owner drift remains rejected.
4. Existing receipt rows recover without database mutation, migration, deletion, author rewriting, helper-registry reclassification, fallback, or title/identifier pattern matching.
5. Historical hydrate and live Session event projection use the same authorization contract, with focused route, projection, negative-integrity, and idempotency tests.
6. Do not restart, refresh, stop, or otherwise interfere with the running OpenCorvus/Overlay process.
7. Preserve all unrelated worktree changes. Commit only task-owned files with a `dsw-33987` subject and push to `myhexin/v0.0.15beta`.

### Hard constraints

- Natural message authorship remains visible and truthful. The Mission receipt must not be relabeled as Chat output.
- `sessionAgentID` is the session owner; `agentID` is the real participant for the individual message.
- A typed persisted relationship, not a permissive multi-participant rule, authorizes owner/participant separation.
- No database migration or reset, no compatibility branch, no UI-only suppression, and no removal of strict identity failures.
- The existing helper-participant, root-message, dynamic-worker, Task conversation, and Agent Rail contracts remain intact.

### Sources read before implementation

- `AGENTS.md`
- `specs/records/2026-07/2026-07-21-chat-mission-inline-conversation-handoff.md`
- `specs/records/2026-07/2026-07-20-legacy-assistant-conversation-identity.md`
- `specs/records/2026-07/2026-07-20-agent-rail-helper-session-identity.md`
- `packages/opencorvus/src/mission/caller-receipt.ts`
- `packages/opencorvus/src/orchestrator/protocol/message-bridge.ts`
- `packages/opencorvus/src/protocol/session-mirror.ts`
- `packages/opencorvus/src/conversation/view.ts`
- `packages/opencorvus/src/agent/persisted-session-identity.ts`
- `packages/opencorvus/src/chat/session.ts`
- `packages/opencorvus/src/server/routes/session.ts`
- Backend conversation, session-stream, caller-receipt, protocol projection, and Overlay tree-writer tests found by the searches below.
- Read-only production SQLite `/Users/yangheng/.local/share/opencorvus/opencorvus.db` and current sidecar log `/Users/yangheng/.local/share/opencorvus/log/2026-07-22T123048-54041-1.log`.

### Whole-repository search evidence

- `rg -n "recordMissionCallerReceipt|attachMissionCaller|publishMissionHandoff|ensureMissionCallerReceiptBridge" packages/opencorvus/src packages/opencorvus/test packages/overlay/src` found one receipt writer/bridge, one Panel caller attachment path, project bootstrap installation, and focused tests.
- `rg -n "projectConversationView|projectConversationAgentView|sessionAgentID|agentID drift" packages/opencorvus/src packages/opencorvus/test packages/overlay/src packages/overlay/test` found the shared backend projector used by standalone Session and Task hydrate/history routes plus strict Overlay consumers.
- `rg -n "enrichMessageEventProperties|overlayMeta|enrichStandaloneSessionTranscript" packages/opencorvus/src packages/opencorvus/test` found one common message metadata projector used by live Session events, Task protocol events, and persisted standalone hydration.
- `rg -n "MissionCallerMetadata|MissionReceiptMetadata|missionCaller|missionReceipt" packages/opencorvus/src packages/opencorvus/test` found no second Mission caller/receipt contract outside `mission/caller-receipt.ts`.
- Read-only SQLite aggregation found 14 right-sidebar Chats, 4 current `chat,mission` conflicts, 10 caller-linked Missions, and 4 written receipts. All four written receipts currently have `terminal_reason=aborted`; the other terminal reasons share the same writer by code contract but are not production database observations.

### Call-site treatment

| Call site                                         | Treatment                                                                                                                                                                    |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mission/caller-receipt.ts`                       | Keep the receipt in the caller Chat with truthful Mission authorship; export the strict persisted receipt-part metadata schema used by the authorization resolver.           |
| Mission caller participant authorization          | Add one resolver that proves the receipt part, referenced Mission, project/directory, Mission ID, caller Chat, and caller message all agree.                                 |
| `overlayMeta`                                     | Preserve existing root/helper/worker rules; only a proven Mission receipt receives `sessionAgentID=chat`, `agentID=mission`, plus explicit projected authorization evidence. |
| Message event cache and persisted lookup          | Carry message ID and parent message ID so both message-first and part-first live events can resolve the same persisted authorization.                                        |
| Standalone transcript enrichment                  | Reuse `overlayMeta`; do not add a route-specific repair.                                                                                                                     |
| `projectConversationView` / Agent Rail projection | Consume explicit authorization evidence, keep one stable owner, retain truthful per-message participant, and continue rejecting unproven native participant drift.           |
| Overlay tree writer and Agent Rail                | Keep strict existing consumers; they already distinguish `sessionAgentID` from `agentID`.                                                                                    |
| Existing SQLite rows                              | No mutation. Their persisted TextPart metadata and Mission caller linkage are the canonical evidence used by the repaired projector.                                         |

### Independent Agent feedback

- The independent read-only reviewer confirmed the 4/14 impact and accepted the owner/participant split.
- It rejected unconditional multi-participant support because that would swallow real `chat -> coding` drift.
- It recommended truthful Mission authorship plus a persisted, explicitly validated cross-session participation contract, and rejected helper-registry reclassification, author rewriting, receipt deletion, and moving the receipt to a separate hydration source.

### Codex review feedback and revision

- The second independent review rejected the initial implementation because receipt-shaped Part metadata plus valid caller lineage did not prove that the message was the one formal receipt named by `metadata.mission.receipt`.
- The revision now verifies the formal receipt pointer's message ID, Part ID, and terminal reason; binds projected evidence to the owner Session, owner Agent, message, parent message, and Mission Session; and rejects copied or transplanted evidence.
- The receipt message, Part, formal Mission pointer, and related Session effects now commit through one `Session.persistMessage` transaction. Live Bus observers therefore cannot see the message before the formal pointer is durable.
- A real post-commit Bus test now projects both `message.updated` and `message.part.updated` while asserting the formal pointer is already visible. This replaces the earlier claim based only on direct post-persistence projector calls.

## Causal chain

- Observable: selecting the affected Prism Chat leaves the current Conversation unchanged.
- Direct trigger: `GET /session/ses_076ce16e1ffeZ9EkThst32FjHu/conversation` returns HTTP 500 with `agentID drift: chat -> mission`.
- Persisted evidence: the Chat has ordinary `agent=chat` messages followed by one terminal receipt authored by `mission`; its TextPart identifies Mission `ses_076cd1664ffe1Tmq3uT7338ZbQ`, whose metadata points back to the exact caller Chat and caller message.
- Deep cause: the receipt writer intentionally creates a real cross-session participant message, but `overlayMeta` and `projectConversationView` only model owner/participant separation for registered helper Agents. The backend therefore replaces the Chat owner with Mission or rejects the truthful participant before the already-capable Overlay can hydrate it.
- Why tests missed it: the caller-receipt unit test asserts persistence and idempotency but never calls the Conversation route or the live message bridge; conversation tests separately assert strict native drift without the valid caller-receipt relationship.

## Implementation plan

1. Centralize and validate the existing persisted Mission caller-receipt participation evidence.
2. Commit the receipt message, Part, and formal Mission pointer atomically, then project stable owner and truthful participant identities through historical and live message metadata.
3. Teach the shared Conversation view to accept only that explicit authorization while preserving all negative identity invariants.
4. Add four-terminal route coverage, live message/part event coverage, idempotency, current-record-shaped projection coverage, and forged/unrelated participant rejection.
5. Run focused backend/Overlay tests, package typecheck, document-health checks, diff review, independent second review, commit only owned files, and push git-cc.

## Verification ledger

- `bun test packages/opencorvus/test/server/session-conversation-routes.test.ts packages/opencorvus/test/mission/caller-receipt.test.ts packages/opencorvus/test/server/conversation-view.test.ts packages/opencorvus/test/protocol/session-mirror.test.ts packages/opencorvus/test/session/session.test.ts`: 78 passed, 0 failed across the combined focused cases.
- Coverage includes all four terminal reasons, real Conversation route hydration, historical projection, post-commit Bus message/Part projection, atomic receipt-pointer visibility, transaction rollback with zero message events when a metadata target is missing, idempotency, unrelated Mission drift rejection, copied receipt rejection, transplanted evidence rejection, and existing helper/native identity invariants.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts packages/opencorvus/test/script/document-health.test.ts`: 87 passed, 0 failed after scoped staging made the new record visible to the repository-index assertion.
- `bun run --cwd packages/opencorvus typecheck`: passed after the concurrent pending-question worktree changes were completed.
- The full focused Session route group now passes after the concurrent pending-question implementation completed; the earlier five SSE failures were confirmed as transient worktree overlap rather than this repair.
- Node Playwright visual check: `chat-mission-inline-handoff-browser.test.ts` passed after temporarily providing the concurrent `pendingQuestions: []` fixture contract; the temporary fixture edit was removed. Inspected screenshots show the original Chat and the in-place Mission view both render in one stable Conversation surface with focused composer and no visual corruption.
