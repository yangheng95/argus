# Desktop started-Task recovery scope repair

## Recall

### User request

The user reported that four stopped Mission rows (`test-E7`, `test-E8`,
`test-E9`, and `test-E10`) still showed rotating progress indicators in the
OpenCorvus Work Ledger.

### Acceptance criteria

- A stopped Mission cannot keep a running indicator solely because a
  started/incomplete child Task was skipped during Desktop backend recovery.
- Desktop startup discovers every started/incomplete Task in the Desktop
  backend's canonical database and initializes each Task root directory through
  the existing host-recovery path.
- An explicitly project-scoped `serve --project-dir` process may still limit
  recovery to that project worktree.
- `--managed-scope` remains only the managed-server ownership-lock identity; it
  never selects a project or filters Task recovery.
- Existing Work Ledger status projection and spinner rendering remain unchanged:
  the frontend continues to display the authoritative Task lifecycle instead of
  hiding stale backend facts.
- Focused recovery, CLI lifecycle, typecheck, document-health, and diff checks
  pass. No running OpenCorvus or Overlay process is restarted, refreshed, or
  stopped for verification.

### Hard constraints

- Preserve the user's existing uncommitted Overlay, browser-test, and
  side-panel-motion documentation changes.
- Do not modify the live database or call the four Task cancellation routes
  while diagnosing the display.
- Do not add a fallback status source, timer, liveness gate, state machine, or
  frontend inference.
- Reuse `recoverStartedTaskExecutions`,
  `runWithInitializedIndependentProject`, the Task fact fields, and the existing
  Work Ledger projection.
- Use Node for any browser verification. This backend-only repair does not
  require changing the Work Ledger visual implementation.

### Sources read

- `AGENTS.md`
- `specs/records/2026-07/2026-07-20-desktop-managed-sidecar-ownership-and-session-diff-failure.md`
- `specs/records/2026-07/2026-07-24-work-ledger-child-status-and-mission-loading.md`
- `specs/records/2026-07/2026-07-25-research-deliverable-case-benchmark.md`
- `specs/records/2026-07/2026-07-26-work-ledger-chat-running-indicator-repair.md`
- `packages/opencorvus/src/cli/cmd/serve.ts`
- `packages/opencorvus/src/engine/host-recovery.ts`
- `packages/opencorvus/src/engine/{task-status,writer,queue}.ts`
- `packages/opencorvus/src/server/managed-server-ownership.ts`
- `packages/opencorvus/src/work-ledger/projection.ts`
- `packages/opencorvus/src/mission/projection.ts`
- `packages/overlay/src/services/work-ledger.ts`
- `packages/overlay/src/components/WorkLedger.tsx`
- Focused recovery, managed-server, Mission-route, and Work Ledger tests found
  by the repository-wide search below.

### Whole-repository search evidence

| Surface | Complete call points and disposition |
| --- | --- |
| Running indicator | `WorkLedger.tsx::sessionLoading` renders the registered loading icon when `workLedgerPresentationStatus` returns `active`; preserve it. |
| Mission presentation | `overlay/services/work-ledger.ts::workLedgerPresentationStatus` returns `active` for an interruptible Mission or one with an active child Task; preserve the authoritative child-Task projection. |
| Backend Mission row | `work-ledger/projection.ts::workLedgerMissionFromCandidate` consumes `mission/projection.ts::missionRecord`, whose Task stats use `deriveTaskStatus`; preserve it. |
| Task lifecycle | `engine/task-status.ts::deriveTaskStatus` derives `active` from `time_started != null && time_completed == null`; do not mask or reinterpret it in the UI. |
| Host recovery callers | `cli/cmd/serve.ts` is the only production caller of `recoverStartedTaskExecutions`; `host-recovery.test.ts` is the only direct test owner. |
| Recovery scope | `host-recovery.ts` has one optional `scopeProjectWorktree` filter. `serve.ts` currently fills it from `managed.scope`; replace that caller input with the explicit resolved `projectDir`. |
| Managed scope | `ManagedServerOwnership.acquire`, Desktop `main.rs::start_server`, managed CLI lifecycle tests, and server ownership tests use the value only as the atomic ownership-lock/watchdog scope. Preserve that contract. |
| Explicit project scope | `serve.ts` already resolves `--project-dir` / `OPENCORVUS_PROJECT_DIR`; use that existing value as the sole optional recovery filter. |
| Recovery tests | `host-recovery.test.ts` already proves unscoped discovery across projects and explicit project-worktree filtering. Add caller regression coverage proving managed ownership does not become recovery scope. |

### Live evidence

- The running Desktop sidecar is
  `opencorvus.exe serve --hostname 127.0.0.1 --port 7878 --managed-scope
  C:\Users\10132\AppData\Local\ai.opencorvus.overlay`.
- `GET /work-ledger?limit=100` reports all four Mission rows as
  `interruptible=false`, but each has exactly one child Task with
  `lifecycleStatus=active`, `started` populated, `completed` absent, and
  `taskStats.active=1`.
- `GET /task/:taskID/status` reports all four Tasks as
  `status=running, lifecycleStatus=active`.
- The previous sidecar log records provider HTTP 429 failures and later
  `[serve] shutdown requested via http.shutdown`.
- Both the previous and current sidecar logs report
  `started Task project recovery attempted=0 initialized=0 failures=0`.
- The four project worktrees are under
  `D:\yerui\code\opencorvus-test-demo`, while the managed ownership scope is
  the Desktop data directory. The exact `Project.samePath` filter therefore
  skips all four before recovery can initialize their Task root directories.

### Independent agent feedback

No independent agent was requested. Current collaboration rules prohibit
implicit delegation, so the primary agent owns the investigation, repair, and
second review.

## Causal chain

The visible rotating indicator is correct for the Work Ledger payload it
receives: each Mission contains one persistently active child Task. The direct
trigger is `workLedgerPresentationStatus`, which maps that active child count to
the Mission's active presentation. The backend rows remain active because the
Desktop process restarted after execution stopped, but startup recovery
attempted zero projects.

The deeper cause is a responsibility mismatch introduced with host recovery.
`managed.scope` is the Desktop backend's exclusive ownership-lock directory, not
an authoritative project worktree. Passing it into
`scopeProjectWorktree` makes a global Desktop server filter its canonical
database by an unrelated application-data path. The existing explicit
`--project-dir` value is the actual project-scope contract. Previous recovery
tests passed because they supplied a real project worktree directly and did not
cover the Desktop caller's data-root value.

## Implementation plan

1. Resolve the optional serve project directory once and keep it available for
   startup recovery.
2. Pass only that explicit project directory into
   `recoverStartedTaskExecutions`; never pass `managed.scope`.
3. Add a CLI source regression that composes with the existing host-recovery
   behavior tests and proves ownership scope cannot filter Task recovery.
4. Run focused recovery/serve/managed-ownership tests, OpenCorvus typecheck,
   document health, and diff checks.
5. Review the exact scoped diff, commit with the required `dsw-33987` prefix,
   fetch, and push the current delivery branch to `myhexin`.

## Implementation

- `serve.ts` now resolves the optional explicit project directory once and
  passes only that value to `recoverStartedTaskExecutions`.
- A Desktop process launched only with `--managed-scope` performs unscoped
  recovery over its canonical database. The managed scope remains exclusively
  the ownership-lock/watchdog identity.
- The CLI regression rejects any reintroduction of `managed.scope` as
  `scopeProjectWorktree`.
- The managed-server lifecycle test now launches its child with the current Bun
  executable, waits until ownership acquisition and recovery have both run,
  and declares a timeout that can actually accommodate its existing
  15-second diagnostic bound on Windows.

## Verification

- `bun test packages/opencorvus/test/engine/host-recovery.test.ts
  packages/opencorvus/test/cli/serve-shutdown.test.ts
  packages/opencorvus/test/cli/managed-serve-lifecycle.test.ts`: 8 passed.
- `bun run --cwd packages/opencorvus typecheck`: passed.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts
  packages/opencorvus/test/script/document-health.test.ts
  packages/opencorvus/test/script/product-docs-single-source.test.ts`: 93
  passed using an isolated Git index that marked both concurrently authored
  July records as tracked without changing the user's real staging area.
- Scoped `git diff --check`: passed.

No frontend source changed, so there is no new visual layout to accept. The
user's screenshot plus the live Work Ledger and Task-status API payloads
establish the visible symptom, while the isolated backend tests exercise the
repaired recovery boundary without restarting or modifying the running
Desktop process.

## Second review

The scoped diff preserves one Task-lifecycle source, one Mission projection,
and one spinner condition. It removes only the incorrect ownership-to-project
scope coupling. The explicit `--project-dir` contract remains the sole optional
recovery filter, and the global Desktop path recovers all started/incomplete
Tasks from its canonical database.
