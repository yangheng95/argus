# Project Bootstrap Recovery Lifecycle Re-entry Repair

Date: 2026-08-02
Status: implemented and verified
Owner: Codex

## Recall

### User request

- Explain why the newest persisted Tasks cannot render in the Overlay.
- Repair the proven root cause rather than edit production Task, Session, message,
  part, or status rows.

### Acceptance criteria

1. A project containing a started incomplete Task with an ownerless interrupted
   Agent Session initializes successfully after process replacement.
2. Recovery terminalizes the ownerless Session through the existing canonical
   Session lifecycle persistence implementation before delivering the existing
   root wake.
3. Project-scoped Task conversation and event routes can initialize the project
   instead of returning HTTP 500 from lifecycle re-entry.
4. The external restart-safe Session status publisher continues to acquire the
   Session's own project identity for callers whose asynchronous completion can
   outlive their original Instance lease.
5. The Instance recursive-lifecycle protection remains strict.
6. Focused recovery tests assert the positive recovered lifecycle, protocol
   Artifact, and drained-wake results while executing recovery inside an actual
   Instance initialization lifecycle.
7. No UI automated test is added, changed, or run. No production database row or
   running OpenCorvus process is restarted, terminated, or rewritten as part of
   implementation verification.
8. The task-owned change is committed with the `dsw-33987` subject prefix and
   pushed to `legacy-remote/v0.0.28beta` without bypassing hooks.

### Hard constraints

- Preserve the canonical status writer and protocol bridge; do not create a
  parallel Session status implementation.
- Do not loosen `Instance.assertNoRecursiveLifecycle`, add a fallback path,
  suppress bootstrap errors, skip interrupted Session settlement, or make the
  Overlay infer renderability.
- Keep bootstrap recovery inside the already-owned project context. Keep the
  public restart-safe publisher for lease-independent asynchronous callers.
- Preserve the existing ordering: terminal Session fact, persisted protocol
  lifecycle, then root wake delivery.
- Preserve all unrelated worktree changes and stage only task-owned paths.

### Sources read

- `AGENTS.md`
- `specs/current/architecture/99-principles.md`
- `specs/records/2026-07/2026-07-27-desktop-started-task-recovery-scope-repair.md`
- `specs/records/2026-08/2026-08-01-dispatch-occurrence-process-recovery-root-repair.md`
- `specs/records/2026-08/2026-08-02-large-build-observation-and-interrupted-task-recovery.md`
- `packages/opencorvus/src/project/{bootstrap,instance}.ts`
- `packages/opencorvus/src/engine/{host-recovery,queue,task-agent-lifecycle}.ts`
- `packages/opencorvus/src/session/status-publication.ts`
- `packages/opencorvus/src/orchestrator/{agent,agent-coordination-session-lifecycle}.ts`
- `packages/opencorvus/test/engine/process-recovery.test.ts`
- `packages/opencorvus/test/fixture/process-recovery-seed.ts`

### Live read-only evidence

| Surface | Evidence |
| --- | --- |
| Running backend | Sidecar `0.0.28-beta` on port 7878 started at 2026-08-02 18:43 local time and owns `~/.local/share/opencorvus/opencorvus.db`. |
| Persisted transcripts | The three newest affected Tasks have 69, 73, and 78 messages across their durable Session lineages. |
| Global list | `GET /global/tasks?limit=20` returns HTTP 200 and includes the affected Tasks. |
| Identity-only read | `GET /task/:id/conversation` without selected project directory returns HTTP 200 with complete transcript payloads. |
| Real Overlay-shaped read | The same route with its Task project `directory` returns HTTP 500 for all three affected Tasks. |
| Startup recovery | Six project directories containing started incomplete Tasks report `Cannot provide project identity recursively while instance context preparation is active`. |
| Visible consequence | Project-scoped `/task/events`, `/chat/capability`, Expert Squad catalog, and conversation hydration cannot complete; Overlay remains `Loading work` / `Connecting`. |

### Whole-repository search evidence

The pre-implementation searches covered:

```text
rg -n "publishSessionStatus|publishSettledSessionTerminalStatus|reconcileInterruptedTaskExecutions|provideProjectIdentity"
rg -n "recover interrupted|interrupted Task|process-recovery|ownerless|Previous backend process ended"
rg -n "assertNoRecursiveLifecycle|runLeaseLifecycle|InstanceBootstrap"
```

| Owner or caller | Disposition |
| --- | --- |
| `session/status-publication.ts::publishSessionStatus` | Preserve. Its Agent runner and cancellation callers may finish outside the original Instance lease. |
| `session/status-publication.ts::publishSettledSessionTerminalStatus` | Preserve as the external restart-safe wrapper; factor its canonical status/protocol body into one shared implementation. |
| `engine/queue.ts::reconcileInterruptedTaskExecutions` | Use an explicit current-project publication entry because the function is owned by the already-active project bootstrap context. Update both compatible and incompatible interrupted-Session branches. |
| `orchestrator/agent.ts` | Preserve the external restart-safe wrapper for startup and execution failure settlement. |
| `orchestrator/agent-coordination-session-lifecycle.ts` | Preserve the external restart-safe wrapper because coordination completion may outlive the caller lease. |
| `engine/task-agent-lifecycle.ts` | Preserve the external restart-safe wrapper for post-settlement cancellation publication. |
| `project/instance.ts::assertNoRecursiveLifecycle` | Preserve unchanged. It correctly rejects trying to acquire the same project identity while its initialization context is incomplete. |
| `project/bootstrap.ts` | Preserve the recovery stage and its failure propagation; recovery itself must obey the owned context. |
| `process-recovery.test.ts` | Move the positive replacement-process recovery call into a real Instance initialization callback and retain assertions for terminal Session evidence, one recovery Artifact, and one drained wake. |

### Independent Agent feedback

No independent Agent was requested. Current collaboration rules prohibit
implicit delegation, so the primary Agent owns implementation and second review.

## Causal chain

The backend restart discovers a started incomplete Task and initializes its
project through `Instance.provide(..., init: InstanceBootstrap)`.
`InstanceBootstrap` calls `reconcileInterruptedTaskExecutions` while the
`instance context preparation` lifecycle is active. Recovery correctly finds an
ownerless streaming/retry Session, but it calls the general
`publishSettledSessionTerminalStatus` wrapper. That wrapper calls
`Instance.provideProjectIdentity` for the same Session directory.

The Instance layer correctly rejects this request because the same project's
initial context has not finished preparation. Recovery then aggregates and
rethrows the error, project initialization rolls back, and every Overlay request
carrying that project directory repeats the same failed initialization. Durable
messages remain readable through directory-free Task record routes, but the real
Overlay project-scoped request cannot reach conversation projection.

The previous recovery regression called `reconcileInterruptedTaskExecutions`
inside the ordinary `fn` body of `Instance.provide` without an `init` callback.
No lifecycle preparation scope was active, so the restart-safe wrapper could
re-enter the already-settled lease and the production failure was not exercised.

## Decision

Keep one canonical settled-terminal publication body. Expose two explicit
ownership entries:

- the existing restart-safe entry acquires the Session's project identity and is
  used by asynchronous callers that may no longer own an Instance lease;
- a current-project entry verifies that the active Instance owns the exact
  Session project, then calls the same canonical body without acquiring a
  second identity lease. Session directories can differ within one Project, so
  directory equality is not a project-identity requirement.

Only project bootstrap recovery uses the current-project entry. This repairs the
responsibility mismatch without weakening lifecycle protection, inventing a
fallback, or duplicating persistence logic.

## Implementation plan

1. Factor the existing terminal Session status and protocol persistence body
   into one private implementation.
2. Add the explicit current-project publication entry with exact project
   validation while preserving legitimate same-Project execution directories.
3. Route both interrupted recovery branches through that entry.
4. Make the replacement-process recovery regression run inside the Instance
   initialization lifecycle.
5. Run focused process-recovery and Instance lifecycle tests, OpenCorvus
   typecheck, document health, and scoped diff checks.
6. Re-read the plan and diff, review lifecycle ownership and all callers, commit,
   fetch, verify the current branch, and push to `legacy-remote`.

## Implementation

- `status-publication.ts` now owns one private settled-terminal implementation
  for the Session latch, terminal status, and durable protocol lifecycle event.
- The existing `publishSettledSessionTerminalStatus` remains the explicit
  lease-independent entry and still acquires identity from the Session
  directory.
- `publishSettledSessionTerminalStatusInCurrentProject` is the explicit
  project-owned entry. It requires an active Instance with the Session's exact
  project identity, then invokes the same canonical implementation without
  trying to acquire another lifecycle lease.
- Both compatible and incompatible interrupted-Session recovery branches use
  the current-project entry.
- The replacement-process recovery regression now performs bridge installation,
  runner registration, and reconciliation inside the `init` callback of a real
  `Instance.provide`. Completion-hook waiting remains after initialization,
  matching production ownership and avoiding an artificial initializer wait on
  the Task loop.

## Verification

- `bun test packages/opencorvus/test/engine/process-recovery.test.ts`: 2 passed.
- `bun test packages/opencorvus/test/session/agent-turn-lifecycle-persistence.test.ts`:
  1 passed.
- `bun test packages/opencorvus/test/project/instance-cache.test.ts`: 38 passed.
- `bun test packages/opencorvus/test/project/open-lifecycle.test.ts`: 4 passed.
- `bun test packages/opencorvus/test/engine/host-recovery.test.ts`: 2 passed.
- `bun run --cwd packages/opencorvus typecheck`: passed.
- Historical links, Document Health, and product documentation single-source
  suites: 70 passed.
- Scoped `git diff --check`: passed.

No UI source changed, so no UI automated test was added, changed, or run. The
production database and running sidecar were not changed or restarted.

## Second review

The first implementation draft required the Session directory to equal the
current Instance directory. Review found that one Project can legitimately own
multiple Task execution directories while recovery enumerates incomplete Tasks
by project identity. The unnecessary directory equality was removed. The
current-project entry now checks the exact durable Project identity, while the
external entry continues to use the Session directory when it must acquire an
independent identity context.

The final diff keeps the Instance recursive-lifecycle protection unchanged,
keeps one canonical status/protocol writer, preserves terminal-before-wake
ordering, and contains no fallback, status suppression, Overlay inference, or
production-data rewrite.
