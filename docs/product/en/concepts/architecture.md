# Architecture

OpenCorvus's job: **turn a natural-language request into verified code changes, reliably**. A single LLM cannot do this reliably alone, so the system consists of a **single decision-maker** (Orchestrator) and a set of **specialist sub-agents**; each agent has its own LLM + tools and reasons independently, invoked by the Orchestrator as needed.

> Important change (2026-05): The old `Task Agent / Planner / GoalPool / Acceptance review` have been removed entirely. The pipeline is no longer a hardcoded six-layer waterfall; execution-process data is merged into a single `engine_artifact` table (differentiated by `kind`). See [Goal / Run / Task](./goal-run-task.md).

## HTTP API runtime layering

The HTTP server (`packages/opencorvus/src/server/server.ts`) splits routes into two real layers:

- **Control plane** — `/global/*`, `/auth/*`, `/ui/*`, plus `/log`, `/shutdown`, `/restart` are mounted before the `Instance.provide` middleware. They work even when no project directory is open. Use these for health checks, server lifecycle, and authentication.
- **Instance-scoped** — every other route (`/session`, `/task`, `/run`, `/mcp`, `/tui`, `/experimental`, `/panel`, …) runs inside `Instance.provide({ directory, init: InstanceBootstrap })`. They require a project directory (resolved from `?directory=` query or `x-opencorvus-directory` header).

Route handlers themselves do not read `process.env`, do not call `Database.use(...)`, do not open SQL tables directly, and do not use `z.any()`. The boundary is enforced by `bun run api:routes-check`; the bilingual API reference is regenerated from OpenAPI by `bun run docs:api` / `docs:check`.

## Inbound: two entry points

```
External channel → ChannelIngress.message       channel/ingress.ts
(Slack /          Inbound routing · binds task_id; deterministically backfills
 HTTP)            when a binding exists and the task has a pending interaction,
                  otherwise enters ControlMessage

Local user     → ControlMessage.handle           control/message.ts
 (overlay /      Short-lived "control" session (not an engine_task);
  TUI)           outputs JSON actions via PanelCapabilityRegistry allowlist
                 (create_task / send_task_message / reply_interaction /
                  cancel_task / retry_task / …)
```

Both entry points converge into `EngineService.createTask` (`task-api/index.ts`) or the existing `Session` / `Question` API.

## Task control loop (kind = `workflow`)

```
orchestrator/loop.ts — runTaskLoop()  (line 117)
┌──────────────────────────────────────────────┐
│  Decision Point (Orchestrator LLM)            │
│    Reads full engine_* state + decision-log   │
│    Decides: which sub-agent? retry? add goal? │
│             deliver? terminate?               │
└────────────┬─────────────────────────────────┘
             │ via 21 tools in orchestrator/tools.ts
             ▼
    ┌─────────────────────────────────────┐
    │ sub-agent (invoked on demand)        │
    │  requirements / architect /         │
    │  frontend_design / build /          │
    │  integrity / prosecute /            │
    │  analyze_intent / deliver / …       │
    └────────────┬────────────────────────┘
                 │ build tool → goal/runner.ts
                 ▼
    ┌─────────────────────────────────────┐
    │ Executor (external process,          │
    │  worktree-isolated)                 │
    │  claude-code / codex / opencorvus   │
    └────────────┬────────────────────────┘
                 │ acceptance diff
                 ▼
    ┌─────────────────────────────────────┐
    │ acceptance/checks/  deterministic +   │
    │  LLM judge                          │
    └────────────┬────────────────────────┘
                 ▼
          back to Decision Point
```

`kind = "build"` tasks skip decomposition / planning / evaluation and go directly to the build tool (`engine_task` rows are still created, so cancel / list / audit all work uniformly).

### No longer present

- ~~`Task Agent` / `Planner` agent / `GoalPool` / `evaluator` agent~~ (removed in Phase 5–6)
- ~~`recoverOrphanedTasks` fire-and-forget~~ (the loop itself is the lifecycle; orphaned tasks are restarted uniformly by the `EngineService.init` serial queue)
- ~~dispatch gate / infinite wake-up~~
- ~~hardcoded 6-layer pipeline~~ — replaced by the two declarative MiniWorkflows in `engine/workflow.ts` (see below); the Orchestrator may deviate from the recommended path

## MiniWorkflow — two declarative templates

| ID         | Suited for                                                    | Recommended steps                                                                |
| ---------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `direct`   | Single-file / bugfix / config / short debug                   | `build` → `deliver`                                                              |
| `pipeline` | Multi-file features / UI replication / cross-module refactors | `frontend_design?` → `requirements` → `architect` → per-goal `build` → `deliver` |

Defined in `engine/workflow.ts`; users can customize via `opencorvus.jsonc`. The Orchestrator retrieves a template via `WorkflowRegistry.resolve(id)` but may still deviate based on its own reasoning.

## Sub-agent overview

| Agent                  | Code                                                                                                                                                       | Responsibility                                                                                                                                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Orchestrator**       | `orchestrator/agent.ts` + `orchestrator/loop.ts`                                                                                                           | Sole decision-maker; advances the task through 21 tools                                                                                                                                                 |
| **Intent Analysis**    | `intent-analysis/agent.ts`                                                                                                                                 | Interprets short / ambiguous requests; outputs intent class / complexity / clarifications                                                                                                               |
| **Requirements**       | `requirements/agent.ts`                                                                                                                                    | Writes REQ-N + foundational decisions via Zod tool output; does not produce goals                                                                                                                       |
| **Architect**          | `architect/agent.ts`                                                                                                                                       | Analyzes boundaries first, then produces at least 2 small, independently executable/verifiable goals; single all-in-one goals are disallowed; also owns interface contracts, traceability, and fidelity |
| **Frontend Design**    | `frontend-design/agent.ts`                                                                                                                                 | Visual references (Figma / images / URL) → frontend template / fillable modules / component and material inventories                                                                                    |
| **Build**              | `build/agent.ts` + `build/index.ts` + `build/report.ts` + `build/types.ts` + `build/screenshot-tool.ts` + `goal/runner.ts` + `agent/sub-agent-protocol.ts` | Actually writes code in the worktree; invoked by the Orchestrator via the `build` tool; owns runtime screenshot capture evidence                                                                        |
| **Integrity Reviewer** | `integrity/agent.ts`                                                                                                                                       | Multi-dimension integrity review (requirement_fidelity / technical_feasibility / hallucination / solution_quality); final workflow acceptance gate                                                      |
| **Prosecutor**         | `prosecutor/agent.ts`                                                                                                                                      | Adversarial review of acceptance candidates                                                                                                                                                               |

Task lifecycle agent-side authority belongs exclusively to the **Orchestrator**: starting / stopping / retrying / cancelling / failing the current task, and publishing new follow-up tasks, must all go through Orchestrator explicit lifecycle tools (e.g. `propose_task`). Integrity review produces the terminal acceptance verdict; Build produces implementation and runtime evidence.

> **Planning tool role removed.** The session-level `src/tool/planner.ts` is a working-memory tool (`add_task / update_task / scratchpad_*`) that any agent can mount to manage its own subtask tree; it is **not** a replacement for the old per-goal planner.
>
> **Acceptance review removed.** Workflow acceptance now runs through `integrity`; runtime screenshot evidence belongs to Build.

## Two nested loops

### Outer: task control loop

`runTaskLoop` (`orchestrator/loop.ts:117`):

```
while (!aborted) {
  Orchestrator.processTask()      ← LLM decides: which sub-agent to call
  await sub-agent / build tool completion
  back to decision point (no mechanical phase progression)
}
```

No event allowlist: the early `trigger.kind ∈ {created, batch_complete, acceptance_rejected, retry}` filter was removed in Phase 2; the LLM reads `engine_*` + decision-log directly to determine its next action.

### Inner: session agentic loop

`SessionLoop` (`session/loop.ts:64`, namespace):

```
while (session active) {
  LLM emits tool-call → tool executes → result written back as part → next turn
}
```

The bridge between the two loops is the build tool → `goal/runner.ts`: it launches an executor session (OpenCorvus / Codex / Claude Code) inside a worktree, injects the prompt, and drives the inner SessionLoop.

See [Agentic Loop](./agent-loop.md).

## Why not a monolithic agent

1. **Each stage has a different I/O contract** — requirements produces Goals + a traceability matrix; architect produces a contract IR; acceptance checks produce a verdict + evidence. Mixing them causes checks to be skipped.
2. **Failures need precise attribution** — requirements wrong → redo requirements; architect wrong → redo architect; build wrong → retry build; acceptance wrong → remediate. This graduated handling is impossible in a monolithic agent.
3. **Parallelism and isolation** — each build runs in an independent git worktree (see [Worktree lifecycle](../../../specs/new-arch/10-worktree-lifecycle.md)), with no cross-contamination; per-task goal parallelism is bounded by `assistant.max_executor_groups` (default 3).
4. **Human-machine interaction granularity** — permission approvals, follow-up messages, and the `question` tool all live in the task loop, not polluting a single LLM context.

## Worktree parallelism

Each build attempt gets its own worktree (path written to `engine_artifact[kind="goal_run_attempt"].payload`, read via `engine/store.ts:findGoalLatestWorkspace`). A failed attempt can be retried without affecting other goals; the final merge is handled by the `acceptance` agent.

## Data flow and model

Execution process data is merged into the single `engine_artifact` table (one of 13 tables), with `kind` distinguishing semantics: `run` · `goal_run_attempt` · `acceptance` · `verification-evidence` · `evaluation` · `verdict` · `patch` · `changed_file` · `diff` · `log` · `report` · `image` · `link` · `git_ref` · `pr` · `integrity_attempt` · `prosecutor_attempt` · `acceptance_evidence_manifest` · `acceptance_surface_manifest` · `acceptance_specialist_review` · `acceptance_review_threw` · `architect_contract_graph` · `orchestrator-stream-error`.

See [Goal / Run / Task](./goal-run-task.md).

## What's next

- [Goal / Run / Task data model](./goal-run-task.md)
- [Agentic loop](./agent-loop.md)
- [OpenCorvus configuration](../opencorvus/configuration.md)
- [Acceptance checks and verdict](../opencorvus/evaluator.md)
