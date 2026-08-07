# Global Composer Project Activation Race Repair

## Recall

### User requirement

- Diagnose and repair the frequent `Send failed: Global Composer Project activation superseded` error shown after submitting from the directory-free global Composer.
- Investigate the concurrency risk with multiple independent Agents before choosing the repair.
- Deliver a first repaired version rather than only reporting the diagnosis.
- Determine whether the `Base` badge beside a read-only “No skills or agent squads were selected” message is another symptom of the same race.

### Acceptance criteria

- A first directory-free Mission submission creates and activates one anonymous Project and reaches the canonical Mission wake boundary without exposing an internal selection-cancellation error.
- A genuine later Project, Task, Chat, or Mission selection continues to supersede stale asynchronous projection work.
- The read-only launch-reference surface keeps its existing first-message semantics; default active Expert Squad state is not misreported as an explicit `@squad` selection.
- The repair does not retry Project or Mission creation, duplicate durable writes, hide an unsent message, or remove the existing stale-result ownership protection.
- Positive non-User-Interface contracts cover the proven concurrency boundary. No User Interface automated test is added, modified, updated, or run.
- The real page is exercised through the Browser with a fresh screenshot and personal visual review after the implementation.

### Hard constraints

- Preserve the user-owned dirty files outside the Overlay and specification paths touched by this repair.
- Do not delete or reset the user's existing database. Any real acceptance uses an isolated source runtime or a disposable anonymous Project created through the normal product path.
- Keep `/mission/wake` as the single Mission creation boundary for this first repair; do not introduce a compatibility route, fallback, blind retry, selection gate, or second active-selection source.
- Keep real user navigation able to supersede stale Project and conversation projections.
- Use Node.js, not Bun, for browser control. Do not create or run UI automated tests.

### Sources read

- `AGENTS.md`.
- `specs/current/architecture/07-panel.md`.
- `specs/records/2026-07/2026-07-31-global-composer-attachment-project-boundary.md`.
- `specs/records/2026-08/2026-08-01-composer-pasted-image-byte-capture.md`.
- `specs/records/2026-08/2026-08-04-first-anonymous-mission-model-handoff-repair.md`.
- `packages/overlay/src/main.tsx`.
- `packages/overlay/src/components/ChatComposer.tsx`.
- `packages/overlay/src/services/workspace.ts`.
- `packages/overlay/src/services/task.ts`.
- `packages/overlay/src/services/conversation-session.ts`.
- `packages/overlay/test/workspace-active-directory.test.ts`.
- `packages/opencorvus/src/server/routes/session.ts`.
- `packages/opencorvus/src/mission/session.ts`.
- `packages/opencorvus/test/server/conversation-launch-references.test.ts`.
- Git history for `0f0671c161`, `3b551dc072`, `e33a008e1c`, and `32893c5844`.
- The current local server log around successful and interrupted anonymous Project allocations.

### Whole-repository search

- Production `selectEpoch` writers are confined to workspace selection, Task selection, Conversation creation/selection, Mission selection handoff, and selected Conversation archive/delete reconciliation.
- `resolveGlobalComposerProject()` reuses one selection epoch through `applyDirectory()`; the Mission submit branch creates its next epoch only after the resolver succeeds.
- Existing positive tests cover a successful allocation, shared concurrent resolver calls, attachment ordering, model capture, and a genuinely superseded directory switch. They do not cover the complete global-launcher-to-first-wake orchestration or identify the second selection owner in the reported failure.
- `workspace.ts` maintained a private `workspaceEpoch`, while startup restoration checked `settingsStore.workspaceEpoch`. Entering global New Chat incremented only the private counter, so a delayed persisted-workspace restoration could still select the old Project and supersede the anonymous Project activation.
- The read-only launch-reference popover intentionally parses visible directives from the first user message, while its `Base` trigger label comes from the active Expert Squad projection. They answer different questions: default active squad versus explicit launch references. Projecting Mission `visibleExpertSquadIDs` into the popover was rejected during real-page review because that snapshot is the visible catalog closure and incorrectly listed Base, Advanced, and Research Studio as if all three were explicitly selected.

### Independent Agent feedback

- Selection-lifecycle audit: the error proves that a second selection intent changed `boardStore.selectEpoch` during Project activation; it does not prove which caller did so. The resolver and subsequent Mission wake do not self-supersede.
- History/regression audit: the epoch is a required stale-result protection introduced by `0f0671c161`; deleting it, swallowing the abort, or retrying the mutation would regress Project/Task/Conversation ownership. The exact visible error was introduced when `e33a008e1c` unified attachment and Mission Project allocation.
- Composer-mode `selectTask("")` is a candidate duplicate lifecycle, but its normal synchronous timing precedes user submission. It must not be declared causal without a reproduced owner trace.

## Evidence-backed implementation plan

1. Use one canonical `settingsStore.workspaceEpoch` for both workspace runtime clears and startup-restore ownership so entering global New Chat invalidates delayed restore work.
2. Keep first-message directives as the single launch-reference source; do not conflate default active Expert Squad state with explicit selection.
3. Add positive non-User-Interface regression coverage for the directory-free workspace intent while retaining the existing newer-selection contract.
4. Run focused Overlay tests, relevant typechecks, the production build, required documentation-health checks, and inspect the final diff.
5. Exercise the real first-submission and read-only launch-reference surfaces, inspect fresh screenshots, update this record with verification evidence, then commit and push the current main delivery branch to `git-cc`.

## Verification record

- Pre-repair Browser reproduction against the source Overlay on `127.0.0.1:5173` completed one first anonymous Mission successfully and captured the expected selection chronology. Historical server evidence for the reported failure shows the new anonymous Project allocation followed during activation by a second `init-git` and project-scope reload for the previously active Project, with no `/mission/wake` for the new Project. This matches delayed restore selecting the old Project through the second workspace-epoch source.
- Focused Overlay contract: `bun test --timeout=0 test/workspace-active-directory.test.ts` passed with 29 tests and 132 expectations, including a direct delayed-startup-restore case after global New Chat establishes the newer intent.
- Overlay and server typechecks passed. The production Vite build passed after transforming 7,073 modules.
- Documentation health passed with 70 tests and 1,188 expectations across historical links, product-document single-source, and document-health suites.
- The existing `initial-workspace-restore-directory-sync.test.ts` suite was also attempted: four cases passed and three task-selection cases failed before reaching this repair boundary because the current test runtime has no `requestAnimationFrame`; the error originates in `card-tree.ts`, not the changed epoch source. No UI-test shim or compatibility patch was added.
- Real-page acceptance used the source Overlay and a doubly isolated source backend whose health endpoint reported its database under `%TEMP%/opencorvus-composer-race-isolated`. Reloading directly into the directory-free Composer produced no activation error. Sending `@squad("base") 隔离环境全局首次发送竞态验收。` through the real Composer created and opened `Anonymous 8bb55f` without a send-failed dialog. Its later terminal error was the expected missing isolated Hugging Face provider credential, after the Project activation and `/mission/wake` boundaries had both succeeded.
- Human visual review rejected the proposed Mission-snapshot projection: the popover listed Base, Advanced, and Research Studio, proving that `visibleExpertSquadIDs` is not an explicit-selection list. That code and test were removed. The original “No skills or agent squads” text is therefore not the send race; it is correct when the first message contains no explicit reference even though Base is the active default squad.
