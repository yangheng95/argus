# World Economy Architect Algorithm Fix

Date: 2026-06-20

## Incident

Task `tsk_ee0fcfef6001twMiEGpYtmKN3h` cancelled while orchestrating the
TradingView world-economy clone. The task had prepared frontend-design evidence
and then added six broad goals, but no build goal executed and the implementation
workspace never gained `src/pages/world-economy/`.

The decisive failure happened before implementation:

- `frontend-research`, `requirements`, and `architect` ended with terminal
  finalizer misses.
- The second Architect failure report shows a 17-goal decomposition existed in
  the worker transcript, but it was never finalized through `submit_architect`.
- The report explicitly noted that acceptance scorers for goals 1-3 were
  accepted as `script_ref` pointing at `package.json`, even though that is not a
  valid repo script.

## Existing Plans Recalled

- `2026-06-16-architect-script-ref-feedback-loop.md` fixed nonexistent
  `script_ref` paths, goal snapshot opacity, and `modify_goal` no-op feedback.
  It did not reject an existing file such as `package.json` when used as a fake
  script.
- `2026-06-11-subagent-finalizer-recovery.md` defines the correct recovery
  architecture for `TerminalToolMissingError`: a visible same-session
  continuation artifact, explicit re-dispatch by the orchestrator, and no hidden
  worker retry loop.
- `2026-06-05-goal-dispatch-visible-process-fix.md` establishes that pending
  goals with no active build must progress through real build dispatch or the
  smallest real prerequisite tool, not plain status text.

## Call-Point Audit

Targeted search covered:

- `packages/opencorvus/src/acceptance/types.ts`
  - Canonical scorer schema. It says `script_ref` runs an existing repo script.
- `packages/opencorvus/src/architect/output-tools.ts`
  - Registration-time and modification-time validation lives here. The current
    check only verifies that `scorer.spec.path` exists and is a file.
- `packages/opencorvus/test/architect/output-tools.test.ts`
  - Existing regression tests cover missing script files and accepted real
    script files.
- `packages/opencorvus/src/agent/runner.ts` and
  `packages/opencorvus/src/session/loop.ts`
  - Terminal tool miss detection remains typed as `TerminalToolMissingError`.
- `packages/opencorvus/src/orchestrator/tools.ts`
  - Stage tool wrappers currently surface stage failures, but do not yet expose
    a first-class continuation artifact for non-build worker finalizer misses.
- `packages/opencorvus/src/prompt/core/orchestrator-core.txt`
  - Owns the LLM-side dispatch discipline for pending goals after graph
    creation.

## Root Cause

There are three distinct defects:

1. `script_ref` data integrity is incomplete. Existing-file validation lets
   `package.json` pass, so Architect receives a false success signal for a
   scorer that cannot be executed as a repo script path.
2. Stage worker finalizer misses discard useful in-session collector state.
   This is why a 17-goal Architect decomposition could appear in the transcript
   but never persist to the task graph.
3. The task-level recovery path degraded from an Architect graph to six broad
   goals and then cancelled before dispatch. Pending goals without build
   attempts are a downstream scheduler symptom, not proof that implementation
   failed.

## Fix Strategy

### Phase 1: ScriptRef Semantic Integrity

Treat `script_ref` as a repo script file reference, not as a generic existing
file reference.

- Reject package manifests such as `package.json` and `*/package.json`.
- Keep accepting existing script files such as `scripts/check.sh`.
- Return one clear data-integrity error from `register_goal` and `modify_goal`
  without mutating the collector.
- Keep one-off command checks on the existing `spec.kind="shell"` path.

This is not a quality gate: it is schema/data integrity. A manifest file is not
the executable script path required by the scorer contract.

### Phase 2: Same-Session Finalizer Recovery

Implement the previously planned continuation path for stage workers that end
with `TerminalToolMissingError` after a child session was created:

- Persist a typed `stage_continuation_request` artifact.
- Return a visible stage-tool result containing `session_id`,
  `continuation_artifact_id`, `finalizer_name`, and the typed failure.
- Add explicit `continuation_artifact_id` inputs to resumable stage tools.
- Thread the continuation into `runAgentSession(existingSessionID)` so the
  runner owns the visible continuation user message and fresh runtime contract.
- Do not add hidden retry loops and do not implicitly continue the latest
  session.

### Phase 3: Reference Visual Clone Graph Discipline

Keep the hard requirement that reference-driven frontend tasks include a final
visual evidence verification/integration goal. Avoid turning every visual detail
into a pre-submit blocker that prevents an otherwise executable graph from being
persisted. Region-specific evidence ownership must remain in the graph and final
verification goal, then be enforced by build, visual QA, and integrity evidence.

### Phase 4: Pending Goal Dispatch Discipline

After a valid graph exists, a workflow task with pending goals and no active
build must call `build({ goalID })` for the first eligible goal or invoke the
smallest real prerequisite tool. It must not loop back into Architect unless the
graph boundary is genuinely invalid.

## Tests

Phase 1 targeted tests:

- `register_goal` rejects `script_ref` path `package.json` even when the file
  exists.
- `modify_goal` rejects `script_ref` path `package.json` without mutating the
  prior goal.
- Existing script files remain accepted and visible in goal snapshots.

Later phases must add message-flow tests proving:

- Architect finalizer miss returns visible continuation-ready evidence.
- Explicit same-stage continuation reuses the same session and consumes exactly
  one continuation artifact.
- A normal same-stage rerun without the artifact starts fresh and does not
  implicitly continue.
- Pending goals after graph creation lead to build dispatch, not plain status or
  redundant Architect loops.

## Acceptance Criteria

- No invalid `script_ref` scorer can enter the Architect collector by pointing at
  `package.json`.
- Architect terminal finalizer misses preserve a visible recovery path into the
  same session instead of discarding collector progress.
- Reference-driven visual clone tasks retain per-region evidence requirements
  without trapping Architect in an unfinalizable loop.
- Pending goals are dispatched through real build attempts once graph evidence is
  valid.
- Targeted regression tests pass and cover the observed task failure class.
