# Delivery Loop Non-Convergence Refactor

Date: 2026-05-03

## Evidence

Four delivery attempts converged on the same two host blockers:

- `specialist:client_contract` reported `evidence_quality` for a pure frontend calculator because goal `imports` / `exports` were treated as a client API contract surface.
- `runtime:web:.` failed during isolated render launch because `bun install` timed out and the failure propagated as only `ETIMEDOUT`, without enough stderr/stdout context for the next build attempt.

The repeated failure guard already exists in `orchestrator/tools.ts`; the non-convergence evidence means the guard must be covered by regression tests and the retry prompt must carry deterministic manifest failure details, not only the delivery agent summary.

## Root Causes

1. `delivery/surface-detector.ts` mixed two meanings of contract: goal-to-goal imports/exports and frontend/backend client contracts.
2. `delivery/checks/visual.ts` discarded render install output on timeout/error paths.
3. `orchestrator/tools.ts` wrote per-goal retry feedback from `rejection_details`, but did not include host manifest failure details in the next build prompt.
4. Repeated failure detection was not pinned by a focused test for specialist review signatures.

## Implementation Plan

1. Remove goal `imports` / `exports` as a `client_contract` activation source. Client contract surfaces must be selected from project evidence such as client files, generated clients, contract dependencies, schemas, routes, or API adapters.
2. Preserve client specialist fail-loud behavior when `client_contract` is selected without file or endpoint evidence. That is a detector/manifest invariant failure, not an advisory user-code issue.
3. Include stdout/stderr tail in isolated render `bun install` failures for both non-zero exits and spawn errors such as timeout.
4. Include manifest failure details in per-goal delivery retry feedback so the build agent sees host gate facts, not just the LLM rejection summary.
5. Add regression tests for pure frontend goal imports/exports, render install failure detail formatting, retry feedback content, and repeated specialist failure signatures.

## 2026-05-03 Follow-up: Feedback Packet Must Reach The Executor

The r42 failure class showed a deeper feedback gap than the original r40/r41
diagnosis: per-goal retry feedback had been repaired, but task-scope host-gate
rejections still depended on the orchestrator LLM restating the failure inside
`build({ request })`. That turns a persisted verdict / manifest artifact into a
short natural-language relay before it reaches the executor, so the execution
agent can miss exact gate ids, DOM evidence, review ids, and the fact that the
failure is task-scoped.

Fix direction landed in code:

1. Build prompt composition now reads the latest rejected `delivery-agent-verdict`
   artifact and matching `DeliveryEvidenceManifest` directly.
2. The prompt includes a canonical JSON feedback packet with scoped
   `rejection_details`, `finalGate`, failed runtime flows, failed review
   evidence, and formatted manifest failures.
3. The same artifact-derived feedback is injected for both scoped
   `build({ goalID, request })` and integrated-tree `build({ request })`.
4. The previous rendered PNG attachment is attached whenever a rejected
   delivery artifact exists, not only when a per-goal retry decision-log entry
   exists.

This does not add a real-time agent channel or a workflow state machine. It
closes the one-way feedback channel by making the executor prompt consume the
same persisted delivery artifacts as the orchestrator, instead of relying on
the orchestrator to summarize them correctly.

## 2026-05-03 Recheck: Closed Feedback Path Versus Remaining Gate Semantics

The recheck found the feedback chain is now covered at the mechanism level:

1. `DeliveryService.verify` builds and persists `DeliveryEvidenceManifest`
   before the delivery agent returns a verdict.
2. `delivery-agent-verdict` artifacts remain the single source for the latest
   rejected delivery result.
3. `composeLatestDeliveryFeedbackForBuild` hydrates the next build context
   directly from those persisted artifacts, including the canonical JSON packet.
4. `BuildAgent` renders the same `deliveryFeedback` field for request-scope,
   goal-scope, MirrorCode, Codex, and Claude Code executor launches.
5. Regression coverage now proves persisted rejected verdict + manifest rows
   become build retry feedback without depending on an orchestrator summary.

This means the prior "5KB artifact -> short natural-language reason -> executor
guesswork" failure mode should not silently return.

The remaining r42 class is different: `runtime-evidence` still uses fixed DOM
thinness thresholds (`min_dom_text_length=120`, `min_dom_node_count=60`) as a
hard runtime gate. Complete feedback can tell the executor exactly why the host
failed the page, but it cannot by itself decide that the gate is semantically
wrong for a compact functional UI. That requires a separate gate-design fix:
either make the threshold part of the acceptance contract, or replace the fixed
DOM-thinness hard gate with visual/functional evidence reviewed in the delivery
completion path.

## 2026-05-04 Follow-up: Repeated Signatures Are Strategy Feedback

The r42 event chain showed that the repeated-signature guard still created a
terminal task failure via `delivery_loop_hard_fail_2` after `review:integrity`
repeated. That did not solve non-convergence: it converted a recoverable
delivery-completeness gap into `task.failed`, `run.aborted`, and
`task.cancelled`, so unattended iteration stopped before the orchestrator could
use the persisted verdict and manifest facts to change strategy.

The corrected behavior is:

1. Repeated failure signatures are recorded in the delivery decision log for
   context and audit only.
2. The repeated-signature guard refuses another identical `delivery_rework`
   prompt, but does not write `status=failed`, does not clean terminal goal
   workspaces, and does not stop the current orchestrator step.
3. The orchestrator must stay in the same task context and choose a different
   strategy before the next `deliver`: `restart_from_stage(plan|executor)`,
   `modify_goal`, or integrated `build({ request })` based on the canonical
   delivery verdict and `DeliveryEvidenceManifest`.
4. A repeated signature cannot become an automatic hard-fail threshold. Operator
   intervention remains possible through normal user messages, but the system
   must not require a manual retry to keep a recoverable task alive.
5. Fix-run budget exhaustion follows the same rule: it blocks another identical
   `delivery_rework`, but remains active strategy feedback. It must not stop the
   orchestrator step and must not present `fail_task` as the ordinary next move.
6. Delivery verification throws follow the same rule when no structured verdict
   exists: they are infrastructure feedback in the same active task context, not
   a stop signal. The orchestrator must repair the delivery tool path or change
   strategy from persisted facts.

## Out Of Scope

- Do not add a new blocked task state or state-machine gate for repeated delivery failures. The existing guard stops identical rework; this refactor verifies and strengthens that path rather than adding a second source.
- Do not add a global node_modules cache until render install diagnostics are reliable. A cache must be lockfile-hash based if added later.
