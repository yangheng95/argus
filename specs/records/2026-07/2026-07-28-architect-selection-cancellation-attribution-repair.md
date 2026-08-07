# Architect Selection and Cancellation Attribution Repair

## Recall

### User request

- Explain why Task `tsk_fa67b5a39001jutNX8Rax1nSBl` repeatedly invoked Architect, decide whether its later `cancelled` terminal state was the same failure, and fully repair the underlying problems.
- Preserve every parallel worktree change. Do not rewrite, stash, reset, restore, or broadly stage unrelated files.
- Do not restart, refresh, close, or otherwise interfere with the running OpenCorvus / Overlay processes.

### Acceptance

1. A structural Architect re-entry that explicitly reads and selects the current executable `GoalGraphProjection` can immediately modify or remove its projected Goals; it never needs to register old Goals as a workaround.
2. A selected executable current Projection and one or more selected `projection:null` Candidates can coexist as semantic sources. Candidates and historical successful Projections never become the `priorGoalGraphProjectionArtifactLocator` and never seed the current Goal collector.
3. The final Architect provenance keeps every selected source while binding the prior role only to the selected current executable Projection.
4. The persistence boundary rejects a `projection:null` Candidate if any caller attempts to use it as an executable prior.
5. Real persisted user / assistant / `artifact_read` / `artifact_select` / Architect output-tool facts cover the re-entry path. A first remove succeeds, concurrent first mutations do not duplicate seeds, and Candidate Goals are not silently promoted.
6. A completed physical Architect Turn remains attributable by Session and final-message identity even if post-Turn provenance or role interpretation fails.
7. Every Task-cancellation request emits one canonical typed `task.cancellation.requested` protocol event with its exact initiating surface and available request / Session / message / tool-call identity; the correlated terminal event and all user-facing debug views remain read-only projections of the winning request fact.
8. The Task row, progress snapshot, `task.updated`, and terminal `task.cancelled` fact commit in one database transaction. A protocol write failure rolls the whole terminal transition back, and a cancelled row without a complete terminal causation chain is a loud data-integrity error.
9. Direct cancel plus cancellation induced by Task delete/archive, Mission abort/delete/archive, Project delete, Panel, and Orchestrator tools preserve their exact source and product surface. The server, not the Overlay client, owns actor, source, and request correlation identity.
10. OpenAPI, generated TypeScript SDK, English and Chinese API references, and lifecycle examples expose the same required cancellation provenance request bodies.
11. Targeted tests, typecheck, API route checks, document-health checks, real Node Playwright verification, and independent second review passes.

### Hard constraints

- Consumer-owned Artifact discovery and `artifact_select` remain authoritative. The scheduler must not preselect or copy Artifact bodies into the Architect prompt.
- Do not preload the database current tip unless the Architect selected that exact locator in the same physical Turn.
- Do not add a workflow gate, fallback, compatibility path, hidden message, synthetic message, state machine, or Candidate-to-Projection coercion.
- GoalGraph Candidate facts remain durable supporting evidence and never become executable membership.
- Cancellation settlement must still prove owned prompt / queue termination before writing `cancelled`; attribution is evidence, not a bypass.
- A cancellation request may lose a concurrent terminal race, but it must never overwrite the winning terminal cause or report a non-cancelled terminal state as cancellation success.
- No database migration. The canonical cancellation-origin payload lives only in protocol events. Task metadata retains only its existing `cancelled` terminal-state boolean and never duplicates actor, surface, request, reason, or causation fields; Decision Log may reference a protocol event ID but never copy the payload.

### Evidence read

- Runtime database: `/Users/yangheng/.local/share/opencorvus/opencorvus.db`.
- Runtime log: `/Users/yangheng/.local/share/opencorvus/log/2026-07-27T185547-65520-1.log`.
- Artifact protocol: `specs/records/2026-07/2026-07-26-unified-task-artifact-catalog-protocol.md`.
- Current architecture and project rules in `AGENTS.md`.
- Regression commit `7f9b1e9d35` and the then-current `v0.0.21beta` implementation. A parallel release task later committed the shared worktree onto `v0.0.22beta`; this repair preserved that commit and was validated against the resulting current branch.

### Runtime reconstruction

- The initial Architect Turn produced the current executable Projection with nine Goals.
- A later structural re-entry produced a 13-Goal Candidate because the production input projection and output collector were empty and no old Goal could be removed.
- A following Turn legitimately selected the current executable Projection and a null Candidate, but `ArchitectAgent` rejected two Artifacts of the same kind after the Turn.
- A following Turn selected only the Candidate; the adapter mislabeled it as the prior, so membership resolved to zero and all nine removals became unknown.
- The last Architect Turn was externally aborted while working around the empty collector.
- The server log proves a direct `POST /task/tsk_fa67b5a39001jutNX8Rax1nSBl/cancel` started at `2026-07-28T03:11:07.633Z` with request ID `8e7a5186-b1e8-4f72-8054-cb880aaa4a1f` and completed in 98 ms.
- The related Mission abort route started at `2026-07-28T03:11:32.156Z`, roughly 25 seconds later. It did not trigger the Task cancellation.
- Existing durable Task facts omit the HTTP request ID and initiating surface, so the specific UI actor remains unknown; only the direct Task cancel route is proven.

### Full-repository call-point inventory

| Concern                       | Call points / boundaries                                                                                                                                                                                                       | Disposition                                                                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Architect prompt projection   | `packages/opencorvus/src/architect/input-projection.ts`                                                                                                                                                                        | Preserve consumer discovery; clarify current Projection versus Candidate roles.                                                                             |
| Architect adapter             | `packages/opencorvus/src/architect/agent.ts`                                                                                                                                                                                   | Resolve selected Artifact semantic roles, bind only the selected current executable prior, and connect that source to the collector.                        |
| Architect producer identity   | `packages/opencorvus/src/engine/producer-turn.ts`, `packages/opencorvus/src/architect/agent.ts`                                                                                                                                | Reuse the persisted Task / Architect Session / assistant message / tool part / call / visible-tool integrity boundary before selection-backed first output. |
| Architect collector           | `packages/opencorvus/src/architect/output-tools.ts`                                                                                                                                                                            | Add selection-backed, idempotent existing-Goal seeding shared by every visible output tool.                                                                 |
| Selection facts               | `packages/opencorvus/src/agent/artifact-read-facts.ts`                                                                                                                                                                         | Reuse unchanged; its same-Turn complete-read and multi-selection audit already passes.                                                                      |
| GoalGraph schema / tip        | `packages/opencorvus/src/engine/goal-graph-projection.ts`, `packages/opencorvus/src/engine/store.ts`                                                                                                                           | Reuse the unique executable current-tip resolver and exact locator identity.                                                                                |
| Architect persistence         | `packages/opencorvus/src/orchestrator/architect-stage.ts`, `packages/opencorvus/src/engine/persist.ts`                                                                                                                         | Preserve completed-Turn identity and reject null Candidate-as-prior at adapter and transactional boundaries.                                                |
| Architect tests               | `packages/opencorvus/test/architect/agent.test.ts`, `packages/opencorvus/test/architect/output-tools.test.ts`, `packages/opencorvus/test/engine/goal-versioning.test.ts`                                                       | Replace source-only false confidence with persisted Turn facts and boundary regressions.                                                                    |
| Shared cancellation transport | `packages/transport-protocol/src/index.ts`, `packages/overlay/src/services/task-cancellation.ts`                                                                                                                               | Own the strict surface/reason schema and the sole direct Overlay cancellation transport.                                                                    |
| Direct cancel API             | `packages/opencorvus/src/server/routes/orchestrator.ts`, `packages/opencorvus/src/server/error-handler.ts`                                                                                                                     | Require the shared request body and bind one stable server request ID to the request event and response.                                                    |
| Orchestrator cancel tool      | `packages/opencorvus/src/orchestrator/task-lifecycle-tools.ts`                                                                                                                                                                 | Supply reason plus persisted Session / message / call identity.                                                                                             |
| Panel cancel tool             | `packages/opencorvus/src/tool/panel.ts`, `packages/opencorvus/src/panel/capability.ts`                                                                                                                                         | Require a reason and supply actor, surface, Session, message, and call identity.                                                                            |
| Mission lifecycle             | `packages/opencorvus/src/server/routes/mission.ts`, `packages/overlay/src/services/mission.ts`                                                                                                                                 | Supply mission operation, Mission / Session identity, exact Work Ledger or Composer surface, and request ID.                                                |
| Destructive user callers      | `packages/overlay/src/main.tsx`, `packages/overlay/src/services/task.ts`, `packages/overlay/src/services/workspace.ts`, `packages/overlay/src/components/settings/ArchivePanel.tsx`                                            | Carry exact Work Ledger, Composer, and Archive surfaces for Task/Mission/Project delete or archive paths.                                                   |
| Destructive internal callers  | `packages/opencorvus/src/task-api/index.ts`, `packages/opencorvus/src/project/delete.ts`, `packages/opencorvus/src/server/routes/project.ts`, `packages/opencorvus/src/server/routes/session.ts`                               | Attribute cancellation caused by Task, Project, or Session deletion without changing settlement order.                                                      |
| Cancellation persistence      | `packages/opencorvus/src/engine/state.ts`, `packages/opencorvus/src/engine/model.ts`, `packages/opencorvus/src/engine/protocol.ts`, `packages/opencorvus/src/protocol/store.ts`, `packages/opencorvus/src/engine/event-log.ts` | Persist one typed `task.cancellation.requested` provenance event, correlate the terminal event, and expose only read projections.                           |
| Generated contracts           | `packages/sdk/openapi.json`, `packages/sdk/js/src/gen/**`, `packages/web/src/content/docs/**/reference/{api,mission-task}.mdx`                                                                                                 | Regenerate required bodies, Task/Event projections, SDK methods, and bilingual documentation from the route schemas.                                        |
| Cancellation tests            | `packages/opencorvus/test/task-api/**`, `packages/opencorvus/test/engine/protocol.test.ts`, `packages/opencorvus/test/orchestrator/tools.test.ts`, `packages/opencorvus/test/tool/**`, `packages/opencorvus/test/gateway/**`   | Update every direct caller and assert durable attribution.                                                                                                  |

`rg` found no other production `selectedByKind` ambiguity implementation outside Architect. Direct `cancelTask` calls exist only in Task API internals, the Task cancel route, Mission lifecycle, Panel, Orchestrator lifecycle tools, and the listed tests.

### Independent agent feedback

- Architect audit: the shared Artifact fact layer is correct and its focused tests pass. The missing link is selected-current-Projection to collector initialization; kind is not a semantic role. It recommends exact current-tip matching, `effectiveDependsOn`, and no unconditional database preload.
- Cancellation audit: the direct Task cancel HTTP request precedes Mission abort by about 25 seconds. Existing DB and protocol records cannot retain the request ID or identify the exact UI actor.
- Regression-test audit: current `architect/agent.test.ts` mocks return an unpersisted final message, causing two real failures. The repair needs one physical Turn containing persisted read, select, mutation, and final-message facts; prompt-only tests are insufficient.
- Cancellation second review: terminal Task state and terminal protocol cause were initially split across the Task transaction and an asynchronous effect; the first implementation also silently returned no provenance for broken cancelled rows and had not regenerated OpenAPI / SDK / docs. The repair must make terminal facts atomic, make the read model strict, and regenerate all consumers.
- Architect final review: the first-output metadata check initially accepted nonexistent or mismatched message / part / call identities. Reuse `assertTaskAssistantProducerToolPart` and verify the current project and visible provider name instead of treating non-empty metadata as evidence.
- Integrated final review: `protocol_event.session_id` still used Session ownership semantics (`ON DELETE SET NULL`). Mission deletion therefore erased the request and terminal events' identical Session correlation after correctly cancelling a child Task, letting the projection pass while silently losing Debug Info identity. The protocol Session column must be an immutable audit pointer with no Session foreign key, and a real, unmocked Mission-delete regression must prove the causal chain survives physical Session deletion. That regression also exposed the asynchronous child-terminal notifier racing the same deletion; a canonical `mission.delete` cause that exactly matches the Task's persisted Mission provenance must suppress only the now-invalid wake back into that deleting Mission, while leaving parent-Task notification and every other source unchanged.
- Gateway identity audit: the old Gateway manufactured `sessionID`, `messageID`, and agent name `"gateway"`, while unknown Session-bound agents defaulted to `panel_ui`. This was a systemic authority confusion, not a cancellation-only caller bug. Only an explicit server-created user-interface request context may now acquire `panel_ui`; every LLM mutation uses one exact persisted assistant ToolPart.
- Integrated terminal review found one additional P2 integrity gap: the cancellation request and terminal read projection validated IDs, aggregate, payload, correlation, causation, Session, sequence, and time but did not validate the protocol row `kind`. A raw `command` request or `reply` terminal could therefore masquerade as a canonical event. Both ends now require `kind === "event"` and the regression covers both drifts.
- Final staged review found that retaining the Turn-start Projection as an eligible prior let it seed the collector even when a newer Projection became current before the old one was selected. Eligibility is now resolved lazily from only the current tip immediately before first output; a new real-Turn regression proves pre-selection history remains evidence only.
- The same staged review found that newest-terminal lookup sorted wall-clock time before aggregate sequence. A higher-sequence corrupt terminal with a clock rollback could therefore be hidden behind an older valid terminal. Aggregate `seq` is now the primary ordering authority and the inverse-time regression fails loudly.

## Root cause

Commit `7f9b1e9d35` correctly removed scheduler-selected Artifact inputs, but it also removed the only initialization path for prior Goals. Consumer selection was added as provenance after the model Turn, while the collector still needed those Goals during the Turn. The same adapter then used Artifact `kind` as authority identity, collapsing two schema-defined roles—executable Projection and null Candidate—into one and later allowing a Candidate to occupy the prior slot.

Cancellation is a separate lifecycle and observability defect. The old entry points called one attribution-free `cancelTask`, so the terminal event proved that cancellation happened but not who or what initiated it. The first attribution implementation still wrote the Task row before emitting terminal protocol facts in an asynchronous post-commit effect, allowing a permanent cancelled row with no canonical cause after interruption. Its read model then hid that corruption by returning no projection.

## Implementation

1. Introduce one Architect selected-input role resolver:
   - keep all selected locators as sources;
   - choose a prior only when a selected locator exactly equals the unique current executable GoalGraph tip;
   - treat null Candidates and historical successful Projections as supporting sources.
2. Add an idempotent selection-backed seed callback to the Architect output toolkit. Before the first visible output tool, inspect completed selections earlier in the same Turn and seed the exact then-current executable Projection Goals exactly once using effective current dependencies. Freeze that attempted prior for the Turn so a concurrent newer Projection becomes a stale-prior Candidate at persistence instead of erasing the selection. Never first-seed after output has begun.
3. Make prompt language explicit: select the current executable Projection and its exact linked ContractGraph before the first Goal mutation; Candidates may also be selected as semantic sources but never require registering old Goals as a removal workaround. ContractGraph and fidelity are complete Turn outputs, not additive auto-seeded state, so the Architect must explicitly register the complete desired graph/fidelity from its selected evidence.
4. Preserve completed Architect Turn identity before post-Turn interpretation and reject null prior payloads transactionally.
5. Define one strict cancellation-origin schema and require it for `cancelTask`.
6. Pass exact attribution from every production caller into one canonical `task.cancellation.requested` protocol event. Carry its identity as correlation / causation into the terminal event and event-log/debug projections; do not duplicate the payload into Task metadata or Decision Log.
7. Persist the Task row, progress snapshot, `task.updated`, and terminal event in one transaction. Keep only publication as a post-commit effect, and reject every cancelled read whose terminal causation chain is absent or inconsistent.
8. Make `protocol_event.session_id` an immutable audit correlation pointer rather than a Session ownership foreign key. Do not copy it into cancellation payloads; fresh/reset databases use the canonical schema directly.
9. Use the canonical terminal-causation projection to suppress a child terminal wake only when `mission.delete`, the request Mission identity, and the Task's persisted Mission provenance match exactly. Treat missing or mismatched identity as corruption instead of catching a missing Session.
10. Reuse one strict transport reason/surface schema for direct and cancellation-inducing Task, Mission, and Project mutations; keep actor, source, and request ID server-owned.
11. Replace the Gateway's synthetic Tool context with a strict server-created `panel-ui-request` identity. Reject unknown Session-bound agents instead of silently granting UI authority; keep create/message inputs independent of nonexistent caller Session configuration and attachments; advertise the exact UI schema instead of Mission-only fields.
12. Preserve the same server-owned request ID across the outer Server context, the project-routed child App, the cancellation request event, and the successful HTTP response. Client-supplied request-ID headers are never authoritative.
13. Require `kind === "event"` for both cancellation request and terminal rows before projecting a canonical causal chain.
14. Regenerate OpenAPI, SDK, and bilingual API documentation, classify every generated producer event explicitly in the Overlay tree writer, add focused concurrency/rollback/integrity/browser regressions, then run the required repository checks and review the diff against this Recall.

## Verification

### Required acceptance evidence

- Architect persisted-turn and structural re-entry suite:
  - `bun test packages/opencorvus/test/architect/agent.test.ts packages/opencorvus/test/architect/goal-tool-schema-visible.test.ts packages/opencorvus/test/architect/output-tools-overlap.test.ts packages/opencorvus/test/architect/output-tools.test.ts packages/opencorvus/test/architect/structural-reentry.test.ts`
  - Result: 87 passed, 0 failed, 436 expectations.
- Cancellation transaction, strict projection, concurrency, event log, and Board suite:
  - `bun test packages/opencorvus/test/engine/cancellation-origin.test.ts packages/opencorvus/test/engine/protocol.test.ts packages/opencorvus/test/engine/event-log.test.ts packages/opencorvus/test/workbench/board.test.ts packages/opencorvus/test/task-api/cancel-task-abort-timeout.test.ts`
  - Result: 69 passed, 0 failed, 283 expectations. This includes rollback, A/B terminal winner, missing causation, corrupt aggregate, invalid identity, inverse wall-clock/sequence order, chronology, and non-event request/terminal cases.
- Gateway and server request identity:
  - `bun test packages/opencorvus/test/gateway/control-action.test.ts packages/opencorvus/test/server/onerror-mapping.test.ts`
  - Result: 39 passed, 0 failed. The real `Server.App` matrix traverses all 18 advertised Gateway actions and proves forged request IDs do not enter cancellation provenance.
  - Project-route success-header checks for Session GET and direct Task cancellation: 2 passed, 0 failed.
- Panel and lineage identity:
  - relevant Panel cancellation/deletion tests: 4 passed, 0 failed;
  - Panel actor provenance and authorization matrices: 41 passed, 0 failed;
  - Task terminal lineage notifications: 4 passed, 0 failed;
  - Mission abort/delete routes: 8 passed, 0 failed.
- Transport and generated sources:
  - `bun run --cwd packages/sdk/js build`
  - `bun run docs:api`
  - `bun run api:routes-check`
  - `bun run docs:check`
  - Result: SDK/OpenAPI regenerated; 307 operations in 24 groups; route inventory and bilingual API documents are clean.
- Repository compilation:
  - `bun run typecheck`
  - Result: 8 package typechecks passed; SDK import and AI runtime checks passed.
- Documentation governance:
  - `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts`
  - Result: 30 passed, 0 failed.
  - After staging the new indexed record, `bun test packages/opencorvus/test/script/document-health.test.ts`: 63 passed, 0 failed.
- Overlay event and cancellation projection:
  - generated producer-event classification: 6 passed, 0 failed;
  - cancellation Debug Info, Work Ledger Composer stop, Project deletion, and non-card event projection: 4 passed, 0 failed.
- Real browser verification:
  - `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/controls.test.ts`
  - Result: 1 passed, 0 failed using Node and the isolated real Vite page.
  - Reviewed screenshot: `.scratch/task-actions-cancel-focus.png`; Retry, Replan, and Cancel controls render with a clear Cancel focus/interaction state.

### Independent final review

- The final read-only review found the protocol-kind P2 above; after the fix it reran Architect, cancellation projection/race, protocol, lineage, and Mission DELETE scopes and reported no remaining P0, P1, or P2 in the current core diff.
- A subsequent review of the complete staged delivery found the pre-selection historical-prior P1 and sequence-order P2 above. Both were repaired with direct regressions; the Architect and cancellation core suites then passed at 87/87 and 69/69 respectively, and repository typecheck passed again.
- The review confirmed that Candidate/history Artifacts cannot acquire the executable prior role, first output freezes the selected current Projection, cancelled Task state and terminal facts are atomic, Mission deletion preserves Session attribution, and exact mismatched Mission identity fails visibly.

### Known unrelated shared-worktree test boundaries

- The complete `mission-routes.test.ts` file contains two pre-existing non-cancellation fixtures that insert Tasks without root Sessions and are correctly rejected by the existing Task-artifact recovery integrity check. The eight Mission abort/delete cases in this repair pass independently.
- The complete `orchestrator/tools.test.ts` file contains eight Goal Build redispatch fixtures whose prior Goal attempts are now reported unresolved. The exact cancellation/retry execution-identity case passes and none of those eight call the modified lifecycle identity boundary.
- Several broad Overlay static-layout and directory-state tests currently fail in parallel UI work. The cancellation lifecycle, service requests, Debug Info, event classification, and real Vite browser acceptance listed above pass independently.
- Tests that share the process-global database and module mocks were run in isolated invocations for acceptance; combining unrelated files in one Bun process can create reset/mock interference and is not used as product evidence.

## Follow-up: current-schema cancellation integrity at database initialization

### Recall

#### User requirement

- Repair the `GET /global/tasks?limit=11` HTTP 500 shown by the running v0.0.22-beta Overlay.
- Preserve all parallel worktree changes and do not restart, refresh, close, or otherwise interfere with the running OpenCorvus / Overlay process without explicit authorization.

#### Acceptance

- A current-schema database containing a cancelled Task without the canonical `task.cancellation.requested -> task.cancelled` chain is rejected during the single database initialization boundary.
- A schema refresh never commits restored cancellation data that violates the same canonical projection contract.
- The durable database failure uses `DatabaseUnavailableError`, projects `healthy:false`, and retains the exact reset path instead of letting arbitrary Task-list reads fail later as `500 UnknownError`.
- The invalid database image remains readable and no missing actor, request, Session, message, ToolPart, correlation, or causation identity is fabricated.
- Fresh and valid current-schema databases continue to initialize normally.

#### Hard constraints

- No compatibility projection, silent row skip, fallback, inferred cancellation provenance, migration, route gate, or duplicate cancellation validator.
- A reset remains an explicit destructive user operation. The code repair must not reset or restart the currently running application.
- The relational chain and payload/origin checks used at database initialization and normal Task projection must have one pure contract implementation.

#### Read material

- `AGENTS.md`
- this record's original cancellation Recall, root cause, implementation, and verification
- `specs/records/2026-07/2026-07-20-database-schema-backup-restore.md`
- `specs/records/2026-07/2026-07-27-database-schema-health-false-positive.md`
- `packages/opencorvus/src/engine/cancellation-origin.ts`
- `packages/opencorvus/src/protocol/store.ts`
- `packages/opencorvus/src/storage/db.ts`
- `packages/opencorvus/test/storage/db-path.test.ts`
- live logs and the runtime SQLite database, inspected read-only

#### Runtime evidence

- v0.0.22-beta started at `2026-07-28T07:05:11.080Z` and immediately failed `GET /global/tasks` because terminal event `pev_fa6bbd812001EhJYrAAbbqgzg1` for Task `tsk_fa6b5c240001Y1bgGlCPeLLXDS` has no `causation_id`.
- The Task row is cancelled and its protocol sequence ends with `task.updated` sequence 24 and `task.cancelled` sequence 25. There is no `task.cancellation.requested` event for that Task, so its initiating identity is permanently absent.
- The broken Task was persisted before the current v0.0.22-beta server process opened the database. SQLite `PRAGMA` inspection shows a current table shape, so ordinary schema-drift detection cannot discover the semantic defect.

#### Full-repository search

Searches enumerated `taskCancellationProjection`, `task.cancellation.requested`, `task.cancelled`, `Database.Client`, `ensureCurrentSchema`, `refreshSchemaDatabase`, `restoreCurrentSchemaData`, `assertLosslessSchemaRefresh`, `DatabaseUnavailableError`, `/global/health`, and every database reset surface.

| Owner / call site                                                | Follow-up decision                                                                                                               |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `engine/cancellation-origin.ts`                                  | Keep as the database-backed projection wrapper; extract its event-chain interpretation into one pure protocol contract.          |
| `engine/store.ts::viewTask`                                      | Keep strict projection unchanged; it remains the normal read consumer.                                                           |
| `task-api/index.ts::deletedMissionNotificationTargetForTerminal` | Keep strict projection unchanged; it remains the terminal-notification consumer.                                                 |
| `protocol/store.ts`                                              | Keep as the durable event lookup owner; no compatibility lookup or inferred request event is added.                              |
| `storage/db.ts::Database.Client`                                 | Add current-schema semantic integrity validation after DDL verification.                                                         |
| `storage/db.ts::restoreCurrentSchemaData`                        | Validate restored semantic data inside the restore transaction before commit.                                                    |
| `storage/db.ts::assertLosslessSchemaRefresh`                     | Keep the existing stale-column guard; cancellation integrity is current-data validation, not column restoration.                 |
| `/global/health` and database reset surfaces                     | Keep unchanged; they already project durable database unavailability and require explicit destructive confirmation.              |
| `test/storage/db-path.test.ts`                                   | Add current-schema preservation and schema-refresh rollback regressions using deliberately invalid persisted cancellation facts. |

No sub-agent was used because the user did not request delegation.

### Follow-up implementation plan

1. Extract a pure cancellation event-chain projector from the existing canonical schemas. Both the runtime projection wrapper and database initialization consume it.
2. Read cancelled Task identifiers and their terminal/request protocol rows from the owned SQLite connection, normalize them to the same event view, and apply the pure projector.
3. Convert any semantic-chain failure into durable `DatabaseUnavailableError` code `DATA_INTEGRITY_RESET_REQUIRED`, preserving the exact database path and original integrity error.
4. Run the check for current-schema databases and inside schema-refresh restoration before commit.
5. Add focused current-schema and schema-refresh regressions, then run storage, cancellation, health/error mapping, typecheck, documentation health, and diff review.

### Follow-up verification

- `bun test packages/opencorvus/test/storage/db-path.test.ts`
  - 41 passed, 0 failed, 180 expectations.
  - Proves a valid current cancellation chain opens normally, a current-schema missing-cause row fails closed without rotating or modifying its database, and schema refresh rolls back restored invalid rows while retaining the readable backup.
- `bun test packages/opencorvus/test/engine/cancellation-origin.test.ts packages/opencorvus/test/engine/protocol.test.ts packages/opencorvus/test/workbench/board.test.ts packages/opencorvus/test/task-api/cancel-task-abort-timeout.test.ts`
  - 65 passed, 0 failed, 256 expectations.
  - Proves the extracted pure projector preserves the existing strict origin, kind, aggregate, payload, correlation, Session, sequence, and chronology behavior.
- Gateway, Panel, and Mission cancellation callers:
  - Gateway control action: 11 passed, 0 failed.
  - Panel persisted ToolPart cancellation: 1 passed, 0 failed.
  - Mission abort/delete cancellation subset: 4 passed, 0 failed.
- Database failure projection:
  - global health: 2 passed, 0 failed;
  - server `DatabaseUnavailableError` mapping: 2 passed, 0 failed;
  - Overlay durable database-unavailable connection projection: 1 passed, 0 failed.
- `bun run typecheck`
  - SDK import check, AI runtime check, and all 8 executable workspace typecheck tasks passed.
- `bun run api:routes-check`
  - 6 rules and the 33-file route inventory passed.
- `bun run docs:check`
  - 307 operations in 24 groups passed.
- Documentation governance:
  - historical links and product single-source tests passed;
  - document health passed 92 of 93 checks. Its sole failure is the unrelated concurrently indexed `specs/records/2026-07/README.md -> 2026-07-28-invalid-test-fixture-cleanup.md` reference whose target remains another task's untracked file.
- `git diff --check` passed.

### Follow-up second review

- The first implementation fetched the terminal event's request row before validating the terminal envelope. The review rejected that ordering because a forged terminal plus missing request could hide the more direct terminal corruption. `taskCancellationRequestEventID` now validates the complete terminal side before dereferencing causation.
- The first storage scan parsed every Task metadata object. The review narrowed it to SQLite JSON type selection of only exact boolean `cancelled:true` rows, preventing this cancellation repair from becoming a second general Task-metadata validator and reducing startup work.
- Normal Task projection and database initialization now share `projectTaskCancellationEventChain`; storage owns only row normalization and durable database-failure conversion. No second origin or causal interpretation remains.
- No frontend code or visual presentation changed, so the frontend screenshot acceptance principle is not applicable to this backend storage-boundary repair.
