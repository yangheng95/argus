# Composer Attachment Session-Origin Repair

## Recall

### User request

- Investigate and repair the file/folder composer chain that emits a `message.part.updated` render failure.
- Explain the failure from evidence rather than treating the terminal exception as the root cause.
- Use independent agents to review the diagnosis and correction.

### Acceptance criteria

1. File and folder attachments submitted from the shared composer can produce a part-first standalone Chat event without a tree-writer origin-metadata error.
2. Standalone `message.updated`, `message.part.updated`, and `message.part.delta` use the same persisted-message origin projection as task-owned message events.
3. The event keeps `role`, `author`, `agentID`, `channel`, `resolvedRole`, `originSource`, message-domain `orderKey`, and part-domain `part.orderKey` outside the part where required.
4. No frontend fallback, relaxed validator, duplicated origin derivation, hidden message, gate, or compatibility path is added.
5. Focused protocol, Overlay projection, type, docs, and visual verification pass; the running OpenCorvus/overlay is not restarted or refreshed.

### Hard constraints

- The backend bridge is the single source for persisted message origin; the Overlay continues to reject malformed events.
- File and folder selection already converge through `ChatComposer.addAttachment`; do not fork their transport or message projection.
- Message content remains sourced from the message/part tables; live message events remain ephemeral.
- No new worktree and no interference with the user's running OpenCorvus/overlay process.
- Commits use the `dsw-33987` prefix and the delivery branch is pushed to the legacy remote configured as `origin`.

### Sources read

- `AGENTS.md`
- `specs/README.md`
- `specs/current/architecture/99-principles.md`
- `specs/records/2026-07/2026-07-11-platform-runtime-external-goal-team.md`, especially E2E-17
- `packages/overlay/src/components/ChatComposer.tsx`
- `packages/overlay/src/services/{sse,events,tree-writer}.ts`
- `packages/opencorvus/src/orchestrator/protocol/message-bridge.ts`
- `packages/opencorvus/src/protocol/{session-mirror,store}.ts`
- `packages/opencorvus/src/server/routes/orchestrator.ts`
- `packages/opencorvus/test/protocol/session-mirror.test.ts`
- The pre-revert `bbfd9192a` implementation and the regression-introducing broad revert `d9ab47aed`.

### Whole-repository search evidence and call-point disposition

Searches covered `message.part.updated`, the exact tree-writer exception, `resolvedRole`, `originSource`, `mapSessionBusEvent`, `enrichMessageEventProperties`, ephemeral protocol events, composer attachments, `webkitdirectory`, and all session-mirror tests.

| Call point / sibling | Current evidence | Disposition |
| --- | --- | --- |
| `ChatComposer.addFiles` / `addFolderFiles` | Both converge on `addAttachment`; folder input only adds a relative display filename. | Preserve; no separate file/folder transport fix. |
| `main.tsx -> panelMessage` | Submits the shared attachment array into the standalone Chat path. | Preserve. |
| `message-bridge.enrichMessageEventProperties` | Canonically reads persisted message origin and stamps complete top-level metadata plus message/part order keys. | Reuse as the only message-event projection. |
| `session-mirror.mapSessionBusEvent` message branches | A July 14 broad revert restored duplicate DB lookup/order stamping that drops `role`, `author`, and `originSource`. | Replace duplicate message projection with the canonical bridge helper. |
| `session-mirror.stampSessionEventPayload` | Projects lifecycle, permission, question, removal, and config events that do not all have authoring-message origin. | Preserve. |
| `session-mirror.enrichStandaloneSessionTranscript` | Hydrates persisted messages and must normalize `originSource` consistently. | Use the shared source normalizer. |
| `ProtocolStore.dispatchEphemeral` | Correctly preserves a single live event payload without creating a second message store. | Preserve. |
| `protocolTaskEvent` / task SSE | Task-owned serialization already carries the complete enriched payload. | Preserve. |
| `tree-writer.requirePartEventRouteMeta` | Correctly rejects incomplete part-first origin before mutation. | Preserve strict validation. |
| `session-mirror.test.ts` | The broad revert deleted complete Mission part-first origin assertions and weakened Chat message assertions. | Restore complete-origin regression coverage and retain order-key assertions. |

### Independent-agent feedback

- Independent regression review confirmed the taskless `session-mirror` route from `taskID=""`, matched the diagnostic's exact payload-key set, and identified `d9ab47aed` as the regression that restored duplicate incomplete stamping after `bbfd9192a` had converged the paths.
- Independent frontend/attachment review confirmed `webkitdirectory` files and ordinary files converge through `addAttachment`, then standalone `panelMessage`/`prompt_async`; every folder file therefore exercises the same broken session mirror rather than a separate folder bug. It also confirmed the current tests assert routing/order fields but omit the complete top-level origin tuple.
- Independent backend review confirmed `overlayMeta` correctly produces the observed `agentID=chat/channel=assistant/resolvedRole=user`; the collective error names all required fields even though only `role/author` are absent. It independently recommended deleting the duplicate session DB/order/origin projection and restoring the shared helper plus part-first, delta, source, and fail-loud tests.
- Independent regression review additionally proved the same revert split right-sidebar Chat message identity (`chat`) from lifecycle/ledger identity (`assistant`). Because the attachment path and execution rail share the session, the implementation restores metadata-backed `chat` identity at the persisted-session identity source instead of leaving a second identity defect behind.

## Causal chain

1. The user selects a file or folder; both paths create normal composer attachments.
2. Standalone Chat persists a user message and file part; `message.part.updated` can arrive before `message.updated`.
3. Because the event has no Task identity, it is mirrored by `session-mirror`, not the task-owned message bridge subscription.
4. The current session mirror reads the persisted `role/author/agent` only to calculate routing, then its local stamper emits only `agentID/channel/resolvedRole`.
5. Tree-writer receives a displayable part before its owning message and correctly requires the complete origin tuple to create the turn card.
6. The direct trigger is missing `role/author`; the deeper cause is a reverted duplicate projection path. The attachment itself is valid and merely exposes the part-first ordering contract.
7. Frontend fallback or validator relaxation would hide the broken producer and recreate dual-source identity, so the repair must reconverge session message events on the canonical backend projection.

## Implementation plan

1. Commit and push this evidence-backed plan as the pre-implementation checkpoint.
2. Replace the standalone session mirror's duplicated message lookup/order stamping with `enrichMessageEventProperties` for message update, part update, and delta; normalize hydrate source through the same exported helper.
3. Restore regression assertions for Chat and Mission message-first/part-first complete origin, including no metadata inside `part` and distinct order-key domains.
4. Run focused OpenCorvus and Overlay tests, typechecks, formatting/diff checks, and required spec health tests.
5. Start only an isolated served UI if needed, use Node-launched Playwright, capture and inspect a goal-scoped screenshot without disturbing the running application, then perform a second independent review.
6. Record results, commit with `dsw-33987`, fetch/reconcile the remote branch, and push the delivery commit.

## Verification record

- `packages/opencorvus/test/protocol/session-mirror.test.ts`: 16/16 passed after adding complete Chat file part-first, Mission part-first, message/delta origin, lifecycle identity, and fail-loud coverage.
- `packages/opencorvus/test/server/session-conversation-routes.test.ts`: 11/11 passed after adding a real `/session/:sessionID/events` file-part event with the exact observed shape.
- `packages/opencorvus/test/server/task-message-protocol-bridge.test.ts`: 11/11 passed; task-owned root/sub-agent/helper projection remains intact.
- `packages/overlay/test/tree-writer-projection-primitives.test.ts`: 5/5 passed, including the exact standalone user `file` part-first payload reaching the strict writer without an exception and producing the expected attachment card.
- `packages/opencorvus/test/server/work-ledger-routes.test.ts`: 7/7 passed after restoring metadata-backed Chat identity in the shared session ledger.
- A combined parallel run produced 37 passes plus one 5-second fixture timeout because the Windows Git process supervisor exited before readiness; the exact original test was rerun alone and passed 1/1 in 4.41 seconds. This is recorded as runner concurrency evidence, not treated as a product failure.
- OpenCorvus TypeScript check passed. Overlay TypeScript check passed immediately after this repair, briefly failed during independent review because concurrent, unstaged `TerminalPanel.tsx` work introduced two unrelated type errors, and passed again after that concurrent work was corrected without this repair touching or staging it.
- An isolated server on `127.0.0.1:7897` served the freshly built Overlay without touching the running app. The real composer rendered its Add menu with both `Add supported files` and `Add a folder`; the goal-scoped screenshot was inspected and showed no overlap, clipping, missing controls, or layout regression. Browser error log count was zero. The isolated browser tab and exact verified server process were then closed.
- The required historical-document tests were executed after the plan landed: 75/77 pass. The new monthly record link and both other document suites pass; two historical-link checks still report pre-existing paths embedded in `packages/opencorvus/src/expert-squad/payload.ts`, outside this attachment repair. The repository push hook's docs checker passes.
- Final independent implementation review reconfirmed all focused protocol, route, ledger, and strict tree-writer suites. It requested and received an exact `agentView.sessions[].agentID = chat` assertion for metadata-backed right-sidebar Chat identity; that route suite then passed 11/11, and the temporary unrelated Overlay typecheck failure was rerun green as recorded above.
