# Agent Session Continuation and Prism Planner

## Recall

### User request

- Any recoverable Agent execution should continue in its existing Session instead of restarting the Agent in a new Session.
- Remove Mirror Prism's Requirements-to-Architect architecture and replace it with an ordinary Planner.

### Acceptance

- `dispatch_agent.dispatch.continuation_dispatch_id` and coordination redispatch append a new visible Turn to the exact source worker Session.
- A live worker repair uses the existing Agent-to-Agent coordination `continue` action first; it appends the repair message and runs the next Turn in place without redispatch.
- Session identity has no terminal lifecycle. Protocol status describes the latest physical Turn/runtime occupancy and never prohibits a later Turn in that Session.
- The new dispatch lineage keeps its own immutable execution identity while pointing at the reused child Session.
- Initial dispatch still creates one worker Session; continuation never allocates a replacement Session or managed worktree.
- Mirror Prism contains no Requirements or Architect projected Agent, RequirementSet producer, ContractGraph producer, Goal, or Delivery Slice planning stage.
- Both Prism workflows use one delegated `mirror-prd-stage-planner` after source discovery and before surface observation.
- The Planner publishes one canonical `prism/delivery-plan` Artifact from selected research evidence; downstream Prism workers discover that plan and the system contract from the Task catalog.
- Repository Prism source, generated embedded payload, tests, and current architecture documentation agree.

### Hard constraints

- Preserve all unrelated dirty worktree changes; touch and stage only paths owned by this refactor.
- Do not create a worktree, reset, stash, broadly restore shared paths, or run User Interface automation tests.
- Keep continuation inside the same Task, fixed projected identity, package revision, work scope, workflow occurrence, model, system prompt, and directory.
- Session reuse is not compatibility behavior: continuation has one canonical path and fails when the persisted Session runtime identity is incompatible.
- Use positive non-User-Interface contract tests.

### Read material

- `specs/current/architecture/01-agents.md`
- `specs/current/architecture/03-control.md`
- `specs/current/architecture/13-agent-communication-matrix.md`
- `specs/current/architecture/14-agent-runtime-mode.md`
- `specs/current/architecture/15-agent-facts-and-turns.md`
- `specs/current/architecture/99-principles.md`
- `specs/records/2026-08/2026-08-03-task-closure-residual-escape-removal.md`
- `specs/records/2026-08/2026-08-02-large-build-observation-and-interrupted-task-recovery.md`
- `expert-squads/mirror/prism/{expert-squad.jsonc,README.md,selector.md}`
- Prism scheduler, Requirements, Architect, research, Product Requirements Document, design, code, and MirrorTest Agent prompts and Skills.
- `packages/opencorvus/src/{agent/runner.ts,orchestrator/dispatch-agent-tool.ts,orchestrator/tools.ts}`

### Repository search

- Continuation currently preserves workflow occurrence through `continuation_dispatch_id` but `openLineage` exposes no source child Session to the adapter.
- `runAgentSession` already has a strict `existingSessionID` path with persisted worker descriptor validation; most adapter wrappers do not expose it.
- Managed-worktree dispatch always allocates a new Session/worktree before adapter execution.
- Prism source defines `mirror-prd-stage-requirements-analyst` with the Requirements adapter and `mirror-prd-stage-architect` with the Architect adapter in both workflows.
- Prism downstream prompts are coupled to RequirementSet, ContractGraph, Goal, and Delivery Slice revision subjects.
- The embedded Prism payload is generated from tracked `expert-squads/**` source.

### Independent Agent feedback

- No independent Agent was requested. This refactor is executed in the primary Agent only.

## Root cause

Continuation lineage and Session continuity were modeled separately. The lineage resolver derives the exact prior workflow occurrence but discards its `child_session_id`; every adapter therefore enters the fresh-session branch even though the shared runner already supports strict Session reopening. Managed-worktree setup repeats the same mistake by allocating a replacement Session and worktree before adapter execution.

Prism independently retained the platform's Requirements and Architect adapters as mandatory package roles. That makes ordinary product delivery pay for a RequirementSet-to-ContractGraph-to-Goal projection before its own Product Requirements Document, design, implementation, and review chain. It also makes recovery sensitive to typed collector completion and duplicated evidence locators even though the package already owns a canonical system-project contract.

## Design

### Existing-Session continuation

The canonical recovery order is:

1. For a live worker with an owned runtime contract, use the existing Agent-to-Agent coordination `continue` action. It appends the visible repair message and continues that exact Session directly.
2. When the process/provider Turn has ended and no live continuation owner exists, use `continuation_dispatch_id`. `openLineage` returns the exact source `child_session_id`, `dispatch_agent` records the new immutable lineage against that same Session, and every adapter forwards `existingSessionID` to `runAgentSession`. The runner resolves the physical runtime contract for the next Turn without replacing the Session.

Coordination `redispatch` is reserved for the explicit redispatch action but also reuses the source Session; it no longer allocates a replacement identity.

Any code or documentation that treats a `session.status=terminal` observation as a permanent Session state is invalid. Only Task completion and immutable Turn/dispatch evidence are terminal facts.

For a managed worktree, initial dispatch still creates the worktree. Continuation resolves the persisted Session directory and re-enters that directory; it does not create another worktree. The runner's existing descriptor checks enforce exact identity, adapter Application Binary Interface, package revision, projection hash, model, system prompt, and directory.

### Prism Planner

Delete the Prism Requirements Agent and replace the Architect Agent with `mirror-prd-stage-planner`, a Delegated Worker. It selects the terminal system-project contract and any AInvest authority Artifact, then publishes one `prism/delivery-plan` Artifact containing:

- complete accepted surface and route membership;
- shared shell, data, state, navigation, and journey contracts;
- Product Requirements Document, design, implementation, integration, and acceptance ownership;
- exact writable paths and execution order;
- positive acceptance evidence and known limitations.

The plan does not create RequirementSet, ContractGraph, Goal, Delivery Slice, workflow state, or phase-local Tasks. Every later Prism node runs once per Task and consumes the complete plan plus its declared predecessors.

## Verification

- Focused dispatch lineage and projected-Agent runner tests prove one Session identity across initial and continuation Turns.
- Managed-worktree continuation test proves the persisted worktree directory is reused.
- Prism package tests prove the exact Planner-only planning inventory, delegated Planner role, workflow dependencies, and Artifact handoff.
- Regenerate and check the embedded Expert Squad payload.
- Run focused non-User-Interface tests, package typecheck, route/docs checks, historical document-link health, and `git diff --check`.
