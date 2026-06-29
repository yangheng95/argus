# 2026-06-27 Add OpenCorvus Agent Playbook

## Purpose

This document is the implementation playbook for adding a native OpenCorvus
agent. It exists because adding an agent by copying one nearby file routinely
misses role metadata, tool exposure, runtime tool injection, A2A wiring,
session ownership, handoff schema, replay, and tests.

This playbook is not a future architecture sketch. It is based on the current
runtime sources:

- `packages/opencorvus/src/agent/role-contract.ts`
- `packages/opencorvus/src/agent/tool-pool-contract.ts`
- `packages/opencorvus/src/agent/agent.ts`
- `packages/opencorvus/src/agent/runner.ts`
- `packages/opencorvus/src/agent/coordination-runtime-tools.ts`
- `packages/opencorvus/src/orchestrator/tools.ts`
- `packages/opencorvus/src/session/session.sql.ts`
- `packages/opencorvus/src/session/compaction-handoff.ts`
- `specs/current/architecture/01-agents.md`
- `specs/current/architecture/13-agent-communication-matrix.md`
- `specs/records/2026-06/2026-06-26-enterprise-a2a-protocol-root-repair.md`
- `specs/records/2026-06/2026-06-27-a2a-adversarial-audit.md`

## Terminology

- A2A: Agent-to-Agent. In the current runtime this means the durable
  worker-to-orchestrator coordination protocol using
  `request_orchestrator_decision` and `respond_agent_coordination`.
- SSE: Server-Sent Events. The task conversation stream must be able to project
  agent lifecycle and protocol events after disconnect or replay.
- DB: Database. Current runtime persistence uses the project storage tables and
  durable artifacts, not process memory.
- E2E: End-to-end. A test that proves the route, runtime, protocol artifact,
  projection, and user-observable behavior together.
- UI: User Interface. Overlay-visible task cards, session cards, conversation
  events, and error messages.

## Non-Negotiable Rules

- Do not add a native agent by only editing `agent.ts`.
- Do not create a second source for role metadata, tool visibility, prompt
  policy, session ownership, A2A capability, or runtime continuation.
- Do not use a direct task-root message, hidden note, synthetic message, direct
  session reply, or generic same-kind redispatch as an A2A substitute.
- Do not expose `request_orchestrator_decision` to custom default agents,
  generic coding agents, or non-task-owned sessions.
- Do not rely on `Agent.Info.tools` alone for exact runtime agents. Exact
  runtime contracts skip the global registry; their actual `runAgentSession`
  `toolKit` must include the runtime tool object.
- Do not treat `specs/current/architecture/11-agent-oop-protocol.md` as current runtime
  truth. That file documents a future or partially landed object model.
- Do not add fallback, compatibility aliases, duplicate tool names, hidden
  bridge messages, or state-machine gates to compensate for missing wiring.
- Do not mark an agent addition complete without tests that prove the agent is
  registered, callable, observable, and recoverable along its intended runtime
  path.

## Required Recall Before Editing

Before changing files for a new agent, read the current hard-disk sources and
record the recall in the implementation plan:

```powershell
Get-Content -LiteralPath AGENTS.md
Get-Content -LiteralPath specs/current/architecture/01-agents.md
Get-Content -LiteralPath specs/current/architecture/13-agent-communication-matrix.md
Get-Content -LiteralPath specs/records/2026-06/2026-06-27-a2a-adversarial-audit.md
Get-Content -LiteralPath packages/opencorvus/src/agent/role-contract.ts
Get-Content -LiteralPath packages/opencorvus/src/agent/tool-pool-contract.ts
Get-Content -LiteralPath packages/opencorvus/src/agent/agent.ts
```

Then grep all relevant entry points. Replace `<agent-id>` with the exact
canonical id, for example `frontend-research`.

```powershell
rg -n '"<agent-id>"|<agent-id>|AgentRoleContract|AgentRoleID|roleAssignments|SESSION_KINDS|AgentHandoffSchemaByAgent|runAgentSession|createAgentCoordinationRuntimeTools|request_orchestrator_decision|respond_agent_coordination|redispatch_worker' packages/opencorvus specs AGENTS.md
```

If this inventory is not in the plan, the implementation is considered
uninformed and should not be accepted.

## Classification First

Every proposed agent must be classified before code changes.

| Question                            | Allowed answer     | Consequence                                                                                  |
| ----------------------------------- | ------------------ | -------------------------------------------------------------------------------------------- |
| Is it a lifecycle decision owner?   | `host` or `worker` | Only orchestrator-like coordinators are `host`; normal agents are `worker`.                  |
| Does it own a task session kind?    | yes or no          | If yes, it needs a real `SessionKind`, conversation projection, and runtime ownership tests. |
| Is it a live task worker?           | yes or no          | If yes, it must participate in runtime continuation and A2A request capability.              |
| Does it require runtime contract?   | yes or no          | If yes, `runAgentSession` or equivalent runtime metadata must prove the contract.            |
| Is its runtime exact?               | yes or no          | If yes, static tool pool is insufficient; inject concrete runtime tools.                     |
| Is it skill mountable?              | yes or no          | If yes, skill matrix and prompt profile behavior must derive from `AgentRoleContract`.       |
| Is it orchestrator-dispatched?      | yes or no          | If yes, add an explicit orchestrator tool and tests.                                         |
| Can A2A redispatch it?              | yes or no          | If yes, add concrete redispatch binding and replay tests.                                    |
| Does it persist a durable artifact? | yes or no          | If yes, add artifact kind, schema, projection, and read-context path.                        |

No answer may be implicit. If the proposed role cannot be classified, do not
start implementation.

## Single Sources To Update

### Role Contract

Update `packages/opencorvus/src/agent/role-contract.ts`.

Required changes:

- Add the id to `AgentRoleID`.
- Add exactly one entry to `AgentRoleContract.all`.
- Set `archetype`, `promptEditable`, `defaultPromptRequired`,
  `promptConfigMode`, `promptProfileTarget`, `skillMountable`,
  `agentOwnedSessionKind`, `runtimeContractRequired`,
  `exactRuntimeContract`, and `liveRuntimeContinuation`.
- Write a role description that defines ownership and boundaries, not a vague
  capability slogan.

Acceptance evidence:

- `packages/opencorvus/test/agent/role-contract.test.ts` must prove every
  contract id has a matching registered agent.
- If the role is a live task worker, `packages/opencorvus/test/agent/agent.test.ts`
  must include it in the live worker A2A coverage expectation.

### Agent Registry Projection

Update `packages/opencorvus/src/agent/agent.ts`.

Required changes:

- Import the core prompt or runtime prompt.
- Add a native `result` entry in `buildState()`.
- Use `AgentRoleContract.description("<agent-id>")`.
- Use `AgentToolPool.assignment("<agent-id>")`.
- Add `NATIVE_DEFAULTS["<agent-id>"]` if the agent has an editable or cataloged
  prompt.
- Keep built-in tool pools code-owned. Do not allow `config.agent.<agent>.tools`
  to become a second source.

Acceptance evidence:

- Agent appears in `Agent.list()`.
- `Agent.get("<agent-id>")` returns the expected `archetype`,
  `skill_mountable`, prompt mode, native flag, hidden flag, mode, and tool pool.
- Prompt catalog tests prove its default prompt does not collapse into another
  agent's prompt.

### Tool Pool

Update `packages/opencorvus/src/agent/tool-pool-contract.ts`.

Required changes:

- Add exactly one `roleAssignments["<agent-id>"]`.
- Use canonical global tool ids from `GLOBAL_TOOL_IDS`.
- Put role-owned or runtime-owned tools under `private`.
- Do not add near-synonym tools such as a second read/search/list/memory tool
  with a different name.
- If the role is a live task worker, include
  `request_orchestrator_decision`.
- If the role is not a task-owned worker, do not include
  `request_orchestrator_decision`.

Acceptance evidence:

- Registry filtering resolves the expected visible tools.
- Skill required-tool checks use the same pool.
- Custom default pool still excludes `request_orchestrator_decision`.

### Runtime Implementation

Add or update the owning runtime module, for example:

- `packages/opencorvus/src/<agent-id>/agent.ts`
- `packages/opencorvus/src/<agent-id>/static-tools.ts`
- `packages/opencorvus/src/prompt/core/<agent-id>-core.txt`
- output schema, persistence, and renderer modules if the agent has a terminal
  contract.

Required changes:

- Use `runAgentSession` for streaming Large Language Model execution.
- Pass the correct `kind`, `taskID`, `parentSessionID`, `signal`,
  `continuation`, and `onSessionCreated`.
- Define one terminal contract and one finalizer path.
- Persist the real terminal output or durable artifact. Do not convert failures
  into success-shaped reports.
- Exact runtime agents must merge `createAgentCoordinationRuntimeTools()` into
  the actual `toolKit` passed to `runAgentSession`.
- Non-exact runtime agents may rely on registry tool resolution, but tests must
  prove the tool resolves at runtime.

Acceptance evidence:

- Unit tests intercept `runAgentSession` and assert the actual `toolKit.tools`
  contains required runtime tools.
- Terminal-tool miss, abort, and malformed output paths fail loudly and are
  visible.
- Continuation tests prove the same session is resumed when a continuation
  artifact exists.

### A2A Protocol

For a live task-owned worker, A2A wiring is mandatory.

Worker request side:

- Tool pool includes `request_orchestrator_decision`.
- Exact runtime `toolKit` includes the concrete tool from
  `createAgentCoordinationRuntimeTools()`.
- The worker prompt tells the agent to use A2A for orchestration decisions,
  cancellation, retry, user question, failure, or redispatch requests.

Orchestrator response side:

- `respond_agent_coordination` is the only response path for pending
  `agent_coordination_request` objects.
- Pending A2A request must block direct session reply and direct session cancel.
- Response must claim the pending request before side effects.
- Response/action must be persisted before visible continuation, cancel,
  question, fail, or redispatch side effects.

Acceptance evidence:

- Tests cover request creation, response creation, action creation, visible
  projection, duplicate response behavior, and pending direct-control rejection.
- If the role supports `redispatch_worker`, tests cover concrete redispatch and
  restart/replay recovery.
- If the role does not support `redispatch_worker`, tests prove it is rejected
  explicitly.

### Orchestrator Dispatch

If orchestrator can invoke the new agent, update
`packages/opencorvus/src/orchestrator/tools.ts`.

Required changes:

- Add one explicit orchestrator tool. Do not use generic `task` dispatch.
- Add the private tool id to `ORCHESTRATOR_PRIVATE_TOOL_IDS` in
  `AgentToolPool`.
- Normalize input with a schema.
- Track step start and completion.
- Create the child session under the task orchestrator session.
- Persist summaries, decision-log facts, design specs, artifacts, or reports
  through the owning storage path.
- If the tool supports continuation, use the existing continuation artifact
  pattern rather than starting a fresh session silently.

Acceptance evidence:

- Orchestrator tool description test includes when-to-use and when-not-to-use
  boundaries.
- Tool implementation test proves the child session kind, parent session, task
  id, terminal artifact, and returned tool text.
- Error-path test proves no silent missing session, no swallowed terminal miss,
  and no fake success report.

### Redispatch Worker

If A2A `redispatch_worker` can target the new agent, update the concrete
redispatch bindings in `respond_agent_coordination`.

Required changes:

- Bind by the agent's runtime contract and stage input, not by generic same-kind
  session cloning.
- Preserve the original request id, action id, target session id, parent
  session id, task id, and reason in the replacement dispatch.
- Persist enough artifact data for restart recovery.
- Reject cross-task handles.
- Reject unsupported stages loudly.

Acceptance evidence:

- Accepted redispatch creates one replacement worker session.
- Replay after process restart can complete or report an already completed
  action.
- Unsupported target returns a clear rejection and does not create a session.

### Session Kind And Conversation Projection

Update `packages/opencorvus/src/session/session.sql.ts` if the agent owns a
session kind.

Required changes:

- Add the new kind to `SESSION_KINDS`.
- Document the kind in the SessionKind comment block.
- Do not re-list the enum elsewhere; validators must derive from this tuple.
- Ensure task conversation, session role resolution, and overlay cards identify
  the new kind without guessing from title or message content.

Acceptance evidence:

- Tests prove role contract and session kind stay synchronized for task-owned
  workers.
- Conversation route or projection tests show the session appears with the
  correct agent card and status.
- SSE replay tests cover terminal and streaming status if the agent is visible
  in the task timeline.

### Handoff And Compaction

Update `packages/opencorvus/src/session/compaction-handoff.ts`.

Required changes:

- Add a specific handoff schema under `AgentHandoffSchemaByAgent`.
- Include the agent in the discriminated union.
- Preserve durable instruction sources, active contracts, tool evidence,
  continuation state, and open blockers relevant to the agent.
- Do not let the new role fall into `CustomAgentHandoff` unless it is truly a
  user-defined custom agent.

Acceptance evidence:

- Compaction handoff tests prove the new schema is selected by agent id.
- Handoff round-trip keeps enough context for continuation after context
  compression.

### Prompt Profiles And Skill Mounting

If the agent has `promptProfileTarget !== "none"` or `skillMountable=true`,
verify these surfaces:

- `packages/opencorvus/src/agent/prompt-profile.ts`
- `packages/opencorvus/src/config/prompt-catalog.ts`
- `packages/opencorvus/src/skill/mounts.ts`
- overlay skill matrix components, if public UI labels are affected

Required changes:

- Derive profile targets from `AgentRoleContract`, not from a hand-maintained
  list.
- Derive skill mount visibility from `AgentRoleContract.skillMountable`.
- Derive tool warnings from `AgentToolPool`, not from UI guesses.

Acceptance evidence:

- Prompt catalog lists the new role only when it is supposed to be editable.
- Skill mount route accepts or rejects the role according to the contract.
- Overlay matrix behavior follows backend data.

### Durable Artifacts And Read Context

If the agent produces a durable deliverable, update the artifact model.

Possible surfaces:

- `packages/opencorvus/src/engine/engine.sql.ts`
- artifact schema and renderer modules
- `read_context` aggregation
- decision-log writer
- task conversation projection
- integrity or fact-check consumption path

Required changes:

- Add one canonical artifact kind or reuse an existing semantically correct
  kind.
- Persist the artifact once.
- Reference the artifact from downstream agents through the existing context
  reader.
- Do not duplicate the same payload in decision-log, design specs, and system
  artifacts unless each storage path has a distinct consumer and trace reason.

Acceptance evidence:

- Artifact can be read after process restart.
- Downstream agent sees the artifact through the same context path used in
  production.
- Malformed artifact fails loudly and projects a diagnostic.

## Test Matrix

A new native agent is not complete until the matching tests exist.

| Surface               | Required tests                                                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Role registration     | `AgentRoleContract.all` id has matching `Agent.list()` entry.                                                    |
| Tool pool             | `AgentToolPool.assignment("<agent-id>")` exposes exactly the intended global and private tools.                  |
| A2A worker request    | Live task worker has `request_orchestrator_decision` in static pool and actual runtime `toolKit`.                |
| Runtime execution     | Mock `runAgentSession` and assert `kind`, `taskID`, parent session, terminal tool, and continuation.             |
| Orchestrator dispatch | Tool starts the agent, records durable output, returns visible result, and fails loudly on bad input.            |
| Redispatch            | Accepted and rejected `redispatch_worker` paths are both covered if the role participates.                       |
| Session projection    | Task conversation and SSE projection show streaming, terminal, and error states.                                 |
| Compaction            | Agent handoff schema round-trips after context compression.                                                      |
| Prompt catalog        | Prompt default, append or override mode, and editability match role contract.                                    |
| Skill mount           | Mount visibility and required-tool compatibility derive from backend contract.                                   |
| Restart/replay        | Pending request, pending action, terminal action, and durable artifact survive process restart where applicable. |
| Docs                  | `docs:check` passes and this playbook is updated if the process changes.                                         |

## Definition Of Done

The implementation is done only when the handoff or pull request includes this
evidence table:

| Evidence               | Required content                                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Classification         | Host/worker, session-owned, live worker, exact runtime, skill mountable, A2A participant, redispatch support.             |
| Changed single sources | Exact files changed for role contract, tool pool, registry projection, session kind, runtime, prompt, handoff, artifacts. |
| A2A proof              | Static pool proof and actual runtime `toolKit` proof, or explicit non-participant proof.                                  |
| Dispatch proof         | Orchestrator tool or explicit explanation that the agent is not orchestrator-dispatched.                                  |
| Replay proof           | Restart/replay test results or explicit non-applicability with code evidence.                                             |
| UI projection proof    | Conversation/SSE/overlay behavior or explicit non-visible internal-agent proof.                                           |
| Test commands          | Targeted tests, typecheck, docs check, and any E2E route tests.                                                           |
| Residual risks         | Concrete unimplemented surfaces. Do not write "basically done".                                                           |

## Common Failure Patterns

- Adding `AgentRoleID` and forgetting `AgentRoleContract.all`.
- Adding `AgentRoleContract.all` and forgetting `agent.ts` registration or
  `NATIVE_DEFAULTS`.
- Adding `Agent.Info.tools` manually instead of projecting
  `AgentToolPool.assignment()`.
- Adding `request_orchestrator_decision` to the static pool but not injecting
  `createAgentCoordinationRuntimeTools()` into an exact runtime tool kit.
- Adding an orchestrator tool but forgetting `ORCHESTRATOR_PRIVATE_TOOL_IDS`.
- Adding a session kind but letting overlay infer the role from session title.
- Adding a durable artifact but not making it readable after restart.
- Adding `redispatch_worker` support through a generic same-kind session clone.
- Letting a native agent fall through to `CustomAgentHandoff`.
- Treating direct reply or direct cancel as valid steering while a pending A2A
  request exists.
- Reusing another agent's prompt, terminal tool, or output schema because it
  "looks close".

## Quick Checklist

- [ ] Read required recall files and paste the grep inventory into the plan.
- [ ] Classify the agent before editing.
- [ ] Update `AgentRoleID` and `AgentRoleContract.all`.
- [ ] Update `AgentToolPool.roleAssignments`.
- [ ] Update `agent.ts` registry projection and `NATIVE_DEFAULTS`.
- [ ] Add runtime source, prompt, schema, terminal tool, and persistence.
- [ ] Add `createAgentCoordinationRuntimeTools()` to exact runtime tool kits
      when the role is a live task worker.
- [ ] Add explicit orchestrator tool only if orchestrator dispatches it.
- [ ] Add concrete `redispatch_worker` binding only if supported.
- [ ] Add `SESSION_KINDS` only if the agent owns a session kind.
- [ ] Add compaction handoff schema for every native agent id.
- [ ] Add durable artifact kind and context reader only if the agent produces a
      durable deliverable.
- [ ] Add targeted tests for every changed behavior.
- [ ] Run targeted tests, typecheck, docs check, and diff whitespace check.
- [ ] Perform a second review against this document before claiming completion.
