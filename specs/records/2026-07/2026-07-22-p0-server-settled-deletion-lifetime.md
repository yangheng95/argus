# P0 server-settled deletion lifetime

## Recall

### User requirements

- Investigate why the Prism project Chat does not open, determine impact, obtain an independent review, and implement the correct repair.
- New P0: projects and Chats cannot be deleted.
- Strong deletion contract: incidental problems must not block deletion of a session or Task.

### Acceptance criteria

- Project, Chat, Mission, and Task delete requests, plus `archived=true` requests, are not aborted by the overlay's generic 15-second request timeout while the backend is stopping owned execution and committing deletion. Restore requests keep the normal timeout because they do not settle execution.
- A backend-confirmed deletion remains a UI success even if a later list refresh or local persistence cleanup fails.
- Repeating deletion after the record is already absent is idempotent rather than presented as a failed deletion.
- A real `TaskCancellationIncompleteError` or equivalent server proof that an execution owner is still live continues to preserve the record and remains visible. This is execution safety, not an incidental client-side blocker.
- Tests cover the transport lifetime and post-commit behavior, and the real deletion UI is visually inspected without restarting the user's running OpenCorvus process.

### Hard constraints

- No retry fallback, compatibility path, gate, process-level error swallowing, or second deletion source.
- The backend remains the sole authority for stop/settle/delete ordering; the client waits for its canonical result.
- Do not delete Mission, Chat, or Task rows before actual execution ownership settles.
- Preserve unrelated dirty work in the shared worktree and do not restart or refresh the running OpenCorvus/overlay.
- All tests use the existing toolchain; Playwright is launched with Node.js.

### Material read before implementation

- `specs/records/2026-06/2026-06-29-project-delete-unhandled-rejection.md`
- `specs/records/2026-06/2026-06-28-delete-running-task-no-premature-queue-terminalization.md`
- `specs/records/2026-07/2026-07-02-project-archive-worktree-timeouts.md`
- `packages/overlay/src/services/host-transport.ts`
- `packages/overlay/src/services/api.ts`
- `packages/overlay/src/services/coding-assistant.ts`
- `packages/overlay/src/services/task.ts`
- `packages/overlay/src/services/mission.ts`
- `packages/overlay/src/services/workspace.ts`
- `packages/overlay/src/components/settings/ArchivePanel.tsx`
- `packages/opencorvus/src/task-api/index.ts`
- the current SQLite rows and `/Users/yangheng/.local/share/opencorvus/log/2026-07-22T123048-54041-1.log`

### Full-repository call-site search

| Surface | Call site | Disposition |
| --- | --- | --- |
| Chat delete | `deleteCodingAssistantSession` | Replace generic 15-second lifetime with the shared server-settled lifecycle request contract. Treat absence as the desired state. Keep synchronous row cleanup after confirmation. |
| Chat archive | `setCodingAssistantSessionArchived` | Opt in only for `archived=true`, because restore does not settle execution. Keep post-confirmation selection cleanup outside mutation success. |
| Task delete | `deleteTask` | Use the same contract, move all selection work after the request, make absence idempotent, update the canonical task projection locally after confirmation, and do not make refresh/settings persistence part of deletion success. |
| Task archive | `setTaskArchived` | Opt in only for `archived=true`; restore keeps the default. Keep post-confirmation UI reconciliation outside the durable archive outcome. |
| Mission delete | `deleteMission` | Use the same server-settled contract and treat absence as the desired state. |
| Mission archive | `setMissionArchived` | Opt in only for `archived=true`; restore keeps the default. |
| Project delete | `deleteProjectState` | Use the same contract because project deletion settles every owned Task/session before removing project state. |
| Worktree delete | `deleteProjectWorktree` | Preserve its existing explicit finite 15-minute contract; this is a separate filesystem operation with its own established bound. |
| Credential, mailbox, filesystem and provider DELETE calls | unrelated service wrappers | Preserve the generic timeout; they do not own the Task/session settle lifecycle and must not be swept into this repair. |
| Backend Task/session/project deletion routes | route and Task API call sites | Preserve strict stop/settle proof and committed-cleanup error reporting; do not weaken data safety. |

Searches also covered sibling `/archive`, `/abort`, `DELETE`, `deleteTask`, `deleteMission`, `deleteCodingAssistantSession`, and `deleteProjectState` call sites across `packages/overlay`, route definitions, SDK/OpenAPI output, and server tests.

### Independent agent feedback

- Blocking correction accepted: `timeoutMilliseconds: null` must cover exactly four deletes and the three `archived=true` branches. Restore and unrelated operations keep the generic timeout.
- Blocking correction accepted: `deleteTask` currently clears selection before the request; `setTaskArchived`, the main work-ledger archive handlers, and `ArchivePanel` also mix committed mutation success with later selection/refresh work. These paths must be separated and directly tested.
- Blocking correction accepted: DELETE 404 is idempotent only at delete service boundaries. Project deletion needs a discriminated `deleted | already_absent` result rather than invented project metadata. `TaskArtifactDeletionCommittedError` is successful row deletion for direct Task deletion but only partial project deletion, so project delete must continue to report failure.
- Blocking correction accepted: the log cannot prove what the first aborted project request ultimately did. The record must distinguish observed facts from inference.
- Required regression additions: caller-signal preservation, 409 rejection with row preservation, direct Task committed-cleanup reconciliation, project partial-commit failure, no pre-request selection clear, post-confirmation refresh/settings failure isolation, and ArchivePanel no-double-report behavior.
- Final independent review passed after the committed boundary was extended across ArchivePanel busy/projection/notification/refresh, project close/refresh/notification, and Mission/Task/Chat archive selection/refresh effects. The reviewer reran 86 focused checks successfully and found no remaining blocker.

## Evidence and causal chain

### Observable failure

- Two Prism Chat archive requests started but never returned to the client. Exactly about 15 seconds later the UI recorded `Fetch is aborted`.
- The affected SQLite Chat rows remained present with `time_archived IS NULL`.
- A project delete request also crossed the 15-second boundary and surfaced `Fetch is aborted`; a later duplicate request completed in 884 milliseconds, and the project row was ultimately deleted. The logs do not prove whether the first request committed, failed, or merely changed timing for the second request; claiming that it advanced settlement would be an inference.

### Direct trigger

`HostTransport` applies `DEFAULT_REQUEST_TIMEOUT_MILLISECONDS = 15_000` whenever a caller does not specify a lifetime. Every Chat, Mission, Task, and project archive/delete wrapper used that generic default even though the route can legitimately spend longer stopping execution owners.

### Root design error

The client modeled a server-owned lifecycle transaction as a short interactive HTTP request. Client abort does not prove that the backend transaction stopped; it only severs observation. The backend may later commit, producing the worst possible split: the UI reports failure while durable state has changed, or the UI enables a duplicate request against an operation still settling.

### Secondary committed-success error

`deleteTask` and `setTaskArchived` await a fresh task-list request after the backend mutation. A refresh failure therefore rejects the already-committed operation and tells the caller that deletion/archive failed. This violates the same ownership boundary: refresh health is not deletion durability.

### Why previous paths did not root-fix it

Prior repairs correctly strengthened backend settlement and prevented premature record deletion, but the overlay call sites retained the generic 15-second timeout. The stricter and more truthful backend lifecycle therefore made the old client lifetime assumption easier to hit; relaxing backend settlement would only hide the mismatch and reintroduce unsafe deletion.

## Implementation plan

1. Add one explicit API-layer constructor for server-settled lifecycle requests. It sets `timeoutMilliseconds: null`, while preserving any caller-provided user abort signal. This is opt-in and cannot affect unrelated requests.
2. Apply it to four DELETE calls and only the `archived=true` branches of Chat, Task, and Mission archive. Restore remains a bounded request.
3. Make delete absence idempotent at the service boundary where the desired durable state is simply “record absent”. Do not reinterpret cancellation-incomplete or ordinary 500 errors as success. Model project deletion as a discriminated `deleted | already_absent` result instead of fabricating metadata.
4. Recognize `TaskArtifactDeletionCommittedError` only for direct Task deletion as “row deletion committed, artifact residue remains”; reconcile the row and emit a cleanup diagnostic. The same error during project deletion remains a project failure because the project transaction has not completed.
5. Move active-selection cleanup after server confirmation and reconcile Chat/Task rows synchronously. Decouple settings persistence, list refresh, main handler cleanup, and ArchivePanel reload errors from mutation durability; keep them visible as their own diagnostics without action-failure double reporting.
6. Add focused service/transport/handler tests for every branch, delayed server ownership, idempotent absence, 409 row preservation, committed cleanup, and post-confirmation secondary failures.
7. Run targeted tests, typecheck, API/docs checks, real browser visual acceptance, and a second review. Commit only task-owned files and push the main branch to `myhexin`.

## Verification checklist

- [x] Chat/Task/Mission delete and `archived=true` requests carry no client wall-clock timeout; restore keeps the default.
- [x] Project delete carries no client wall-clock timeout.
- [x] Non-lifecycle requests retain the 15-second default.
- [x] Missing records are idempotent delete success; live-owner settlement failures remain errors and preserve rows.
- [x] Direct Task committed-cleanup errors remove the row and expose residue; project partial-commit errors remain project failures.
- [x] Task-list refresh failure cannot reverse an already confirmed deletion/archive.
- [x] Targeted unit/service tests pass.
- [x] Required docs health tests pass.
- [x] Real browser screenshot is inspected and deletion UI is correct.
- [x] Independent review finds no unresolved P0 defect.
