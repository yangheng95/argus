# Chat Mission Receipt Identity Repair

## Recall

### User request

- The user reported that selecting a `Chat` row no longer enters the conversation page and supplied a desktop screenshot showing the Work Ledger selection while the right pane remained on the empty Chat launcher.

### Acceptance criteria

- A right-sidebar Chat session that launched a Mission remains hydratable after the Mission writes its terminal receipt.
- Selecting that Work Ledger Chat row reaches its conversation instead of clearing the selection and returning to the launcher.
- The terminal receipt remains visible exactly once, belongs to the caller Chat participant, and retains explicit Mission provenance in its part metadata.
- The strict conversation projector continues to reject two different non-helper participant identities inside one execution session.
- Targeted unit and real HTTP route regressions pass, the documentation health suite passes, and an isolated desktop page is opened and visually inspected.

### Hard constraints

- Fix the producer at the identity boundary; do not add a projector fallback, compatibility alias, route bypass, gate, database migration, or frontend error suppression.
- Preserve all unrelated dirty worktree changes.
- Do not restart, refresh, close, or otherwise disturb the user's running OpenCorvus or Overlay processes.
- Keep the task desktop-only. Run browser automation through Node, not Bun.
- Commit with the `dsw-33987` subject prefix and push the current delivery branch to `myhexin` after verification.

### Material read from disk and runtime

- `AGENTS.md`
- `specs/current/architecture/07-panel-reactivity.md`
- `specs/current/architecture/12-overlay-card-system.md`
- `specs/records/2026-07/2026-07-08-chat-default-mission-forwarding-receipt.md`
- `specs/records/2026-07/2026-07-17-coding-assistant-project-context-switch.md`
- `packages/overlay/src/main.tsx`
- `packages/overlay/src/services/coding-assistant.ts`
- `packages/opencorvus/src/chat/session.ts`
- `packages/opencorvus/src/mission/caller-receipt.ts`
- `packages/opencorvus/src/conversation/view.ts`
- `packages/opencorvus/src/protocol/session-mirror.ts`
- `packages/opencorvus/src/orchestrator/protocol/message-bridge.ts`
- `packages/opencorvus/src/server/routes/session.ts`
- `packages/opencorvus/test/mission/caller-receipt.test.ts`
- `packages/opencorvus/test/server/session-conversation-routes.test.ts`
- The running server's read-only `/global/health`, `/work-ledger`, `/coding/session/:id`, `/session/:id/message`, and `/session/:id/conversation` responses.

### Whole-repository search

The investigation used whole-repository `rg` searches for `recordMissionCallerReceipt`, `MissionReceiptMetadata`, `MissionHandoffEvent`, `selectCodingAssistantSession`, `openWorkLedgerChat`, `/session/:sessionID/conversation`, `projectConversationView`, `sessionAgentID`, `RIGHT_SIDEBAR_CHAT_AGENT_ID`, `RIGHT_SIDEBAR_CHAT_SOURCE`, and `resolveAgentModelRef`. The relevant call points and disposition are listed below; no second Mission receipt writer or alternate Chat hydration route exists.

| Call point | Disposition |
| --- | --- |
| `packages/opencorvus/src/mission/caller-receipt.ts` | Replace the Mission participant/model used for a message persisted in the caller Chat session with the canonical Chat participant/model. Preserve Mission identifiers in text-part metadata. |
| `packages/opencorvus/test/mission/caller-receipt.test.ts` | Replace the incorrect Mission-identity expectation and add a real `Server.App()` conversation hydration assertion after the receipt is persisted. |
| `packages/opencorvus/src/server/routes/session.ts` | Keep the route unchanged; it correctly exposes the invalid persisted identity through the strict projector. |
| `packages/opencorvus/src/conversation/view.ts` | Keep the non-helper identity invariant unchanged. Weakening it would hide cross-session ownership corruption. |
| `packages/opencorvus/src/protocol/session-mirror.ts` and `packages/opencorvus/src/orchestrator/protocol/message-bridge.ts` | Keep the canonical enrichment path unchanged; it truthfully reports the persisted mismatch. |
| `packages/overlay/src/services/coding-assistant.ts` | Keep selection and hydration unchanged. The frontend clears an unusable selection only because the server returned HTTP 500. |
| `packages/overlay/src/main.tsx` | Keep Work Ledger dispatch unchanged; it already sends the exact Chat session ID and directory. |

### Independent agent feedback

- None. The user did not request multiple agents or a parallel audit, so no sub-agent was created.

## Evidence and causal chain

The screenshot's first Chat row maps through the running server to session `ses_0779922c9ffemyUMJbB5t23MWU`. The exact directory-scoped coding-session claim succeeds with HTTP 200. The subsequent conversation hydration fails with HTTP 500 and `projectConversationView: session ses_0779922c9ffemyUMJbB5t23MWU agentID drift: chat -> mission`.

The stored transcript begins with Chat-owned messages and ends with deterministic Mission receipt `msg_mission_receipt_ses_0778a3f17ffeOlfLFS2Hhty1B2`, persisted as both `author: mission` and `agent: mission`. `recordMissionCallerReceipt` creates that message in the caller Chat session while resolving the Mission agent/model. The projector correctly treats the first non-helper identity as the session owner, detects the later non-helper Mission identity, and rejects the conversation. `selectCodingAssistantSession` then catches the failed hydration and clears the selected source, which produces the empty launcher observed by the user.

Therefore the observable symptom is not a click-routing or directory-namespace failure. The direct trigger is the HTTP 500 hydration response; the root cause is that a delivery receipt stored in the Chat execution session was authored as the separate Mission participant.

## Implementation

1. Make the receipt's execution identity Chat-owned and resolve its model from the caller Chat session.
2. Preserve Mission provenance only in the receipt text and structured part metadata.
3. Extend the focused test to prove idempotence, canonical Chat author/agent/model fields, provenance metadata, and successful real HTTP conversation hydration.
4. Run the focused tests, the surrounding session-conversation tests, type checking, required documentation tests, and review the final diff against this Recall.
5. Launch an isolated desktop target, select the affected-shape Chat row, inspect the conversation page, and retain screenshot evidence without interacting with the user's running Overlay.

## Delivery status

- `recordMissionCallerReceipt` now persists the deterministic delivery receipt with the canonical Chat author, agent, model, and caller-session overlay. Mission provenance remains in the visible receipt text and structured part metadata.
- The focused regression publishes the same terminal event twice, proves one receipt exists, checks its Chat identity/model and Mission metadata, then hydrates it through the real `Server.App()` HTTP route and asserts a canonical Chat session/message projection.
- Verification passed:
  - `bun test packages/opencorvus/test/mission/caller-receipt.test.ts` (`1` pass)
  - `bun test packages/opencorvus/test/server/session-conversation-routes.test.ts` (`13` passes)
  - `bun run --cwd packages/opencorvus typecheck`
  - the historical links, document health, and product documentation single-source suites (`87` passes)
  - Node browser regression `chat-mission-inline-handoff-browser.test.ts` (`1` pass)
- Isolated desktop visual acceptance clicked the affected-shape Chat Work Ledger row and showed the populated Chat conversation with its user prompt and Chat-owned Mission terminal receipt. The screenshot is `.scratch/chat-receipt-identity-repair/chat-row-opens-conversation.png`.
- Existing-data repair was performed only for the exact reported receipt after checking its message ID, caller session ID, assistant role, Mission author/agent, right-sidebar source, and Mission session metadata. SQLite created the online-consistent backup `.scratch/chat-receipt-identity-repair/opencorvus-before-chat-receipt-20260722-210955.db`; one row changed from `mission/mission` to `chat/chat`; `PRAGMA integrity_check` returned `ok`.
- Without restarting or refreshing the running OpenCorvus/Overlay processes, the reported session's live `/session/ses_0779922c9ffemyUMJbB5t23MWU/conversation?tail_limit=80` response changed from HTTP 500 to HTTP 200. The projected session owner, receipt participant, and receipt session owner are all `chat`.
