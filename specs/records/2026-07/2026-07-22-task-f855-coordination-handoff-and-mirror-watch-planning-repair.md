# Task F855 Coordination Handoff And Mirror Watch Planning Repair

Date: 2026-07-22
Status: Implemented and validated
Owner: Codex

## Recall

### User request

The user supplied stuck Task `tsk_f85524735001bQQa99RjbisIPM`, asked for the cause,
then explicitly requested that the diagnosed problems be repaired.

### Acceptance criteria

- A projected worker coordination handoff must settle the completed prompt generation
  from `streaming` to durable and observable `idle` before the owning
  `dispatch_agent` result returns.
- `respond_agent_coordination(decision="continue")` must then be able to resume the
  same non-terminal worker Session under its frozen runtime contract.
- Mirror Watch must preserve one isolated Goal, Session, authority object, and output
  path for every exact persona, while avoiding the production failure that created the
  Goal first and then attempted 105 separate acceptance-audit rewrites.
- Every expert/persona Goal must carry its canonical-survey `contract_audit` forward
  reference in its initial registration. The existing Architect final validator remains
  the sole authority that rejects unresolved references at submission.
- Focused lifecycle, Architect, Mirror Watch package, generated-payload, typecheck, and
  documentation-health tests must pass.

### Hard constraints

- Do not relax continuation's rejection of genuinely streaming or terminal Sessions.
- Do not add a lifecycle gate, retry loop, fallback continuation, synthetic message,
  hidden wake, status machine, or Mirror-Watch-specific host validator.
- Preserve `prompt_profile.active`, `PromptProfileResolver`, dispatch ownership, and the
  durable coordination mailbox as their existing single sources.
- Preserve the package's explicit-persona isolation contract. Historical real E2E
  evidence proves that one combined persona Goal loses the required independent
  ownership and Session boundary.
- Do not restart, refresh, stop, or otherwise interfere with the running OpenCorvus or
  Overlay process.
- Preserve unrelated `.DS_Store` files and any user changes. Commit subjects use the
  `dsw-33987` prefix and push to `legacy-remote/v0.0.13beta` without bypassing hooks.

### Sources read

- `AGENTS.md`
- Runtime SQLite Task, Session, Message, Part, protocol-event, coordination-request,
  and ownership evidence for `tsk_f85524735001bQQa99RjbisIPM`
- `specs/current/architecture/01-agents.md`
- `specs/current/architecture/03-control.md`
- `specs/current/architecture/13-agent-communication-matrix.md`
- `specs/records/2026-07/2026-07-14-mirror-watch-latest-protocol-e2e.md`
- `specs/records/2026-07/2026-07-21-p0-stateful-mcp-coordination-cancellation-convergence.md`
- `specs/records/2026-07/2026-07-22-turn-projection-and-coordination-handoff-repair.md`
- `packages/opencorvus/src/agent/runner.ts`
- `packages/opencorvus/src/session/status.ts`
- `packages/opencorvus/src/session/status-publication.ts`
- `packages/opencorvus/src/orchestrator/tools.ts`
- `packages/opencorvus/test/agent/runner-prompt.test.ts`
- `packages/opencorvus/test/orchestrator/tools.test.ts`
- `packages/opencorvus/test/architect/output-tools.test.ts`
- Mirror Watch requirements, Architect, Orchestrator prompts, manifest, README, and
  focused package tests.

### Whole-repository search evidence

The pre-plan search covered 405 matches for `coordinationHandoff`,
`coordination_handoff`, `publishSessionStatus`, `respond_agent_coordination`,
`architect_goal_min_count`, the fixed 109/108/214 graph counts, persona Goal wording,
and `contract_audit` across production code, tests, current architecture, the active
package, and July records.

Relevant call-point disposition:

| Surface | Current evidence | Disposition |
| --- | --- | --- |
| `runAgentSessionInner` coordination return | Returns the typed handoff without publishing idle. | Publish and await idle before returning the handoff. |
| `validateAgentCoordinationContinueTarget` | Correctly rejects live streaming/retry and terminal Sessions. | Preserve unchanged. |
| Runner handoff regression | Mocks `SessionPrompt.prompt`, never creates streaming state, and asserts only non-terminal. | Start from streaming and require both in-memory and durable idle evidence. |
| `request_orchestrator_decision` / processor drain | Correctly persists and drains the typed handoff. | Preserve unchanged. |
| Architect goal tools | Already accept forward `contract_audit` IDs and reject unresolved IDs only at final submission. | Reuse this mature contract; no host change. |
| Mirror Watch Requirements | Correctly preserves the 109 independent ownership boundaries. | Preserve. |
| Mirror Watch Architect prompt | Requires audits but does not require them in initial Goal registration, allowing late 105-Goal rewrite work. | Require initial forward references and prohibit audit-only rewrite passes. |
| Mirror Watch Orchestrator prompt | Validates final graph counts but does not state that the initial Goal artifact must already contain its audit. | Pin the initial-registration invariant before accepting Architect output. |
| Mirror Watch focused package test | Pins the graph and audit presence, not initial forward-reference timing. | Add exact positive and negative prompt assertions. |
| Generated expert-squad payload | Bundles tracked package bytes. | Regenerate after source prompt changes and verify freshness. |

No sub-agent was used because the user did not request delegation or parallel Agents.

## Causal diagnosis

The Architect successfully registered the 109 draft Goals, 108 graph contracts, 214
dependency reasons, and one assembly owner, but only 18 of 105 persona Goals had been
rewritten with the canonical-survey audit. It handed control back with 87 rewrites still
pending. The runner returned that typed handoff while the Session remained `streaming`.
The Orchestrator's legal `continue` response was consequently rejected by the unchanged
streaming-safety check, after which the Orchestrator emitted prose-only waiting and hit
`OrchestratorNoDecisionStopError`.

The package-side work was unnecessary: Architect goal registration already permits a
forward graph-contract reference and final submission already blocks an unresolved
reference. The prompt failed to require that existing capability at initial Goal creation.

## Implementation plan

1. Add a production-shaped runner regression that enters streaming before a typed
   handoff and requires durable idle lifecycle events.
2. Publish awaited idle from the runner's coordination-handoff boundary while preserving
   normal domain terminal and error publication.
3. Tighten the Mirror Watch Architect and Orchestrator overlays so all consumer Goals
   carry forward contract audits at initial registration and audit-only rewrite passes are
   forbidden.
4. Extend the focused Mirror Watch test, regenerate the tracked package payload, and
   verify source/payload parity.
5. Update current architecture with the handoff lifecycle boundary, run focused and
   required documentation/type checks, inspect the final diff, then commit and push.

## Validation plan

- `bun test packages/opencorvus/test/agent/runner-prompt.test.ts`
- `bun test packages/opencorvus/test/orchestrator/tools.test.ts -t "respond_agent_coordination continue consumes a pending request and resumes the same worker session"`
- `bun test packages/opencorvus/test/architect/output-tools.test.ts -t "register_goal accepts forward contract_audit ids"`
- `bun test packages/opencorvus/test/expert-squad/mirror-watch-package.test.ts`
- `bun test packages/opencorvus/test/expert-squad/payload-generation.test.ts`
- `bun run --cwd packages/opencorvus typecheck`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `bun test packages/opencorvus/test/script/document-health.test.ts`
- `bun test packages/opencorvus/test/script/product-docs-single-source.test.ts`
- `git diff --check`

## Implementation result

- `runAgentSessionInner` now awaits an idle lifecycle publication before returning a
  typed coordination handoff. It does not publish terminal and does not weaken the
  continuation validator.
- The runner regression starts from an actual streaming status and proves the database
  receives `session.status(streaming)`, `session.status(idle)`, and `session.idle` while
  retaining the visible `agent.coordination.requested` event.
- Mirror Watch now requires every expert/persona Goal and the report Goal to carry their
  graph-contract audits in the initial Goal registration through the existing forward
  reference contract. It explicitly rejects the production pattern that created
  consumer Goals first and scheduled an audit-only rewrite pass later.
- The tracked Expert Squad payload was regenerated from the canonical authoring package.
  The original stuck Task remains immutable failure evidence; this code change does not
  rewrite its incomplete Architect collector or interfere with the running process.

## Validation evidence

- Runner lifecycle suite: 16 passed, 0 failed.
- Same-Session coordination continuation regression: 1 passed, 0 failed.
- Architect, Mirror Watch, and payload suites: 81 passed, 0 failed, 798 assertions.
- OpenCorvus TypeScript typecheck passed.
- Historical links, document health, and product-doc single-source suites: 87 passed,
  0 failed, 1,415 assertions. The first document-health pass correctly required the new
  record to be staged before its tracked-index assertion; the staged rerun passed.
- `git diff --check` passed before final review.
