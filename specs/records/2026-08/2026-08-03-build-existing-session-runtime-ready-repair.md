# Build Existing-Session Runtime-Ready Repair

Date: 2026-08-03
Status: implemented and verified
Owner: Codex

## Recall

### User request

- Diagnose why Task `tsk_fc7e2832e00159fTPVH9s6AcQn` could not recover after its backend process ended while the Base Developer was executing `apply_patch`.
- Repair the proven root cause so the existing Build Session can run another physical Turn inside the same Task, workflow occurrence, and dispatch lineage.

### Acceptance criteria

1. A fresh Build dispatch records its newly created Session before runtime readiness and returns the existing terminal typed outcome.
2. A Build continuation initializes the adapter's one bound Session identity from `execution.existingSessionID`; `onRuntimeReady` accepts that exact identity without requiring the fresh-only `onSessionCreated` callback.
3. A mismatched runtime-ready identity remains an explicit infrastructure failure. No fallback, replacement Session, second workflow occurrence, compatibility alias, or Host gate is introduced.
4. The focused positive continuation contract asserts the exact `terminal_success` dispatch result, existing child Session identity, immutable continuation lineage, and completed coordination action.
5. Focused non-User Interface tests, package typecheck, route/docs checks, document health, and diff review pass.
6. No production database row, historical Task, running backend, or Overlay process is mutated or restarted during implementation.
7. Changes are committed with the `dsw-33987` prefix and pushed to `legacy-remote/v0.0.29beta` without bypassing hooks.

### Hard constraints

- Preserve the unrelated untracked `specs/artifacts/五客户端长链路业务与开发需求.md`.
- Keep Session reuse as the single continuation path defined by the existing architecture; do not create a fresh Build Session or worktree during continuation.
- Do not add fallback, retry loops, gates, state machines, keyword classifiers, synthetic messages, database migrations, or negative tests.
- Do not add, modify, or run User Interface automated tests.
- Touch the Build adapter owner, its focused positive non-User Interface contract, this record, required spec indexes, and only the exact stale positive fixtures exposed by the required focused runner/Orchestrator verification.

### Sources read

- `AGENTS.md`
- `specs/current/architecture/03-control.md`
- `specs/current/architecture/08-agent-tool-adapter.md`
- `specs/records/2026-08/2026-08-02-large-build-observation-and-interrupted-task-recovery.md`
- `specs/records/2026-08/2026-08-03-agent-session-continuation-and-prism-planner.md`
- `packages/opencorvus/src/agent/runner.ts`
- `packages/opencorvus/src/build/agent.ts`
- `packages/opencorvus/src/orchestrator/build-tool.ts`
- `packages/opencorvus/test/orchestrator/tools.test.ts`
- Read-only SQLite records for Task `tsk_fc7e2832e00159fTPVH9s6AcQn`, root Session `ses_0381d7ca8ffe6o3G42sg6MzZ2f`, Orchestrator Session `ses_0381d5e3affeNfsblyQ33nNbzI`, and Build Session `ses_0380ea198fferb6pVh0pPmKlU3`.

### Repository and runtime evidence

- The Build Session created real files, then the backend ended while `apply_patch` Part `prt_fc7f51287001V1KA7VmxSdkkhV` remained pending.
- Process recovery correctly terminalized the orphaned physical Sessions and woke the same Task.
- Every continuation lineage preserved child Session `ses_0380ea198fferb6pVh0pPmKlU3` and workflow occurrence `art_fc7f15e63001Jzgsm1wcwrs8GJ`.
- Every continued Build dispatch failed before a new Turn with `Runtime-ready Session ses_0380ea198fferb6pVh0pPmKlU3 does not match created Build Session <unset>`.
- `runAgentSession` intentionally invokes `onSessionCreated` only for a fresh Session and invokes `onRuntimeReady` for both fresh and existing Sessions.
- `createBuildTool` forwards `execution.existingSessionID` but initializes its comparison identity to `undefined`, so every valid existing-Session continuation fails at the adapter boundary.
- Commit `7913605bcc27e0dfabfca22b7aa97a8416bc8ba3` added the production `existingSessionID` forwarding. Its test mock seeded existing Session identity correctly, while the production adapter did not.
- The focused test `task-scoped Build redispatch binds the existing child Session and replays idempotently` passed before repair because it did not assert the returned typed dispatch outcome.
- Repository searches used: `rg -n "Runtime-ready Session|created Build Session|existingSessionID|onSessionCreated|onRuntimeReady" packages/opencorvus/src packages/opencorvus/test` and `git blame`/`git log -S` on `orchestrator/build-tool.ts`.
- The backend URL from the incident was `http://127.0.0.1:7878`; it was no longer listening during diagnosis, so no current process identity or live post-repair reproduction is available without a separately authorized restart.

### Independent Agent feedback

- No independent Agent was requested. The primary Agent owns implementation and second review.

### Pre-push toolchain evidence

- The first baseline push reached the original pre-push checker. Full typecheck exhausted Node's default approximately 4 GiB heap without producing a type diagnostic.
- The exact `packages/opencorvus` typecheck passed with `NODE_OPTIONS=--max-old-space-size=8192` in 206.7 seconds; subsequent full-hook typecheck, `api:routes-check`, and `docs:check` also passed.
- The full hook then exposed drift introduced by merged commit `e9815258b7`: `packages/overlay/src/index.html` changed while both locale `_meta.panel_revision` values retained the previous digest. The hook-computed canonical revision is `c455aa70cbca0187`; synchronizing that metadata is required before any push and does not change visible User Interface content.
- Concurrent commit `2c623454d9` appended an unrelated Work Ledger plan to the shared spec indexes after this Recall commit. It does not overlap the Build adapter, focused test, or this record and is preserved unchanged.
- The required expanded non-User Interface run exposed current-contract drift in the already touched Orchestrator test file and the directly relevant runner fixture: Expert Squad packages were written to an assumed temporary directory instead of the root Session's canonical capability Project directory, the `fail_task` assertion retained the superseded public phrase `Task ... failed`, and the mocked Provider model omitted the now-required output limit. These fixtures must be aligned to the current positive contracts before the run can count as acceptance.
- Re-running the corrected package-directory setup proved a second fixture defect: direct test package writes occur after the Project Instance has cached its available-package inventory, while the fixture bypasses the production Manager's canonical `ExpertSquadRegistry.invalidateAvailable()` call. The shared explicit-install fixture must invalidate that one Registry inventory after a completed write; Resolver discovery remains strict and receives no alternate filesystem path.

## Root cause

The Build adapter models the Session identity as if every invocation creates a Session. Continuation now correctly supplies `existingSessionID`, but the adapter still waits for the fresh-only `onSessionCreated` callback to initialize `createdSessionID`. The runner skips that callback for an existing Session and then emits `onRuntimeReady(existingSession)`, causing the adapter to compare the correct runtime identity against `undefined`.

The repeated scheduler continuations cannot heal this deterministic adapter mismatch. The historical Orchestrator later misclassified the repository-owned adapter defect as external force majeure and called `fail_task`; this later terminal decision explains why ordinary interrupted-execution recovery no longer re-enters the Task, but it is not the first bad transition.

## Design

Use one adapter-owned bound Session identity:

- initialize it from `execution.existingSessionID` for continuation;
- set it from `onSessionCreated` for a fresh dispatch;
- require `onRuntimeReady` to equal that one identity;
- keep both lineage writes unchanged: fresh creation records `runtimeReady: false`, then runtime readiness records the exact descriptor-backed Session.

This is the existing strict Session contract, not compatibility behavior. The mismatch error remains authoritative for any different identity.

## Implementation and verification sequence

1. Commit and push this Recall baseline, including exact repair of any original pre-push toolchain failure encountered on the current remote head.
2. Repair the single identity owner in `orchestrator/build-tool.ts`.
3. Update the existing continuation test to assert the returned `terminal_success` output with the original Session and final message.
4. Run the focused Build continuation test and relevant Build/runner contracts.
5. Run `packages/opencorvus` typecheck, route/docs checks, historical document links, document health, product docs single source, and `git diff --check`.
6. Review the exact diff and verify the unrelated artifact remains untouched.
7. Update this record with results, commit, and push `legacy-remote/v0.0.29beta`.

## Implementation and verification evidence

Implemented on 2026-08-03:

- `createBuildTool` now initializes its one bound Session identity from `execution.existingSessionID`. A fresh dispatch binds that same variable from `onSessionCreated`; runtime readiness must equal the bound identity before descriptor-backed lineage recording proceeds.
- The exact mismatch remains an error. The adapter does not allocate a replacement Session, create another workflow occurrence, retry internally, weaken runtime identity validation, or discover an alternate path.
- The Build redispatch contract now asserts the returned `terminal_success`, original child Session ID, final message ID, immutable lineage, completed coordination action, and public serialized output. The pre-repair version of this test passed without observing the adapter failure; the replacement assertion enters the actual typed outcome.
- The expanded verification repaired stale positive fixtures encountered in the touched test surface: Provider models declare their output limit, explicit package-install fixtures invalidate the single Registry inventory after writing, package selection resolves the root Session's canonical capability Project directory, and `fail_task` asserts the current inactive/force-majeure public wording.
- Full verification exposed concurrent commit `076de76141`, which checkpointed these exact owner changes together with unrelated Work Ledger and artifact changes. The committed Build files match the reviewed implementation; history was preserved rather than rewritten.

Verification results:

```text
bun test packages/opencorvus/test/orchestrator/tools.test.ts \
  packages/opencorvus/test/orchestrator/dispatch-agent-tool.test.ts
# 86 pass, 0 fail, 513 assertions

bun test packages/opencorvus/test/agent/runner-base-template.test.ts
# 11 pass, 0 fail, 43 assertions

NODE_OPTIONS=--max-old-space-size=8192 bun run --cwd packages/opencorvus typecheck
# pass in 345.9 seconds

bun run api:routes-check
# pass: 6 rules, 33 route files

bun run docs:check
# pass: 311 operations, 24 groups

bun test packages/opencorvus/test/script/historical-docs-links.test.ts \
  packages/opencorvus/test/script/document-health.test.ts \
  packages/opencorvus/test/script/product-docs-single-source.test.ts
# 70 pass, 0 fail, 1188 assertions

bun run --cwd packages/overlay check:i18n
# pass

git diff --check
# pass
```

The historical production database and failed Task were not mutated. Port 7878 remained unavailable, and no backend or Overlay process was restarted; therefore the historical Task was not retried as part of this source repair. A real same-Task Retry requires a running backend loaded from the repaired source and remains an operator-controlled follow-up.
