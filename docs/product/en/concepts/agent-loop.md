# Agentic Loop

The executor internals follow the **standard agentic loop**: LLM emits tool-call → tool executes → result fed back → next turn. This page covers the three states, the key invariants, and how this inner loop connects to the Orchestrator's outer task loop.

## Three states

`SessionLoop` (`packages/opencorvus/src/session/loop.ts:64`, namespace) is always in one of:

| State | Meaning | Exit |
|---|---|---|
| **standby** | assistant emitted `finish`; waiting for the next user message | new user message arrives |
| **tool-call** | LLM requested tools; they're executing | all tools resolved |
| **subtask** | current turn spawned a subtask (recursive SessionLoop) | subtask completes |

Standby detection: scan the last user/assistant pair; if the assistant's `finishReason !== "tool-calls"` and no new user message is queued → standby.

## Tool routing

Each tool-call returned by the LLM is routed by `resolveTools()` inside `session/loop.ts` (`session/loop.ts:1779`). The historical `SessionToolResolver` class / `session/tool-resolver.ts` file no longer exist; tool resolution logic has been merged into the SessionLoop itself.

1. **Filter** — applies the `input.tools` allow-list to avoid sending 30+ tools to DashScope.
2. **Permission check** — `PermissionNext.ask()` (see [Permissions](../opencorvus/permissions.md)).
3. **Execute** — dispatch to the corresponding tool handler.
4. **Write back** — the result becomes a `tool-result` part on the session message stream.

## Sub-tasks

Sub-tasks are spawned by `TaskTool` (`tool/task.ts`) and recurse into a new SessionLoop inside the current one. This supports arbitrary nesting: main agent → research sub-agent → … → tool execution.

Each sub-agent (requirements / architect / build / integrity / …) also runs as a new SessionLoop started by `agent/runner.ts:runAgentSession`; their SessionKind is fixed at creation time (see [SessionKind list](../../../specs/new-arch/02-data.md#session-domain-5-tables)).

## How the outer task loop triggers the SessionLoop

The outer `runTaskLoop` (`orchestrator/loop.ts:117`) has the Orchestrator LLM call the `build` tool; the build tool's execution body is `goal/runner.ts`, which starts a build session inside an isolated git worktree using the executor selected by `executor/registry.ts` (OpenCorvus / Codex / Claude Code):

```
Orchestrator.runTaskLoop                                  orchestrator/loop.ts:117
  └─ Orchestrator LLM calls build tool                   orchestrator/tools.ts
      └─ goal/runner.ts (worktree + executor)             goal/runner.ts
          └─ executor (claude-code / codex / opencorvus)  executor/*.ts
              └─ build SessionLoop                        session/loop.ts
```

> **OpenCorvus is just the brand name for the `opencode` executor** (commit `b85ff20d4`); the code entity is still `OpencorvusExecutor` (`executor/opencorvus.ts`). Both `opencode` and `opencorvus` are valid executor IDs for the `--executor=` flag or `executor.discover` config.

## Key invariants

### 1. Must use `streamText`, never `generateText`

`session/llm.ts::LLM.stream` uses Vercel AI SDK's `streamText`. **Do not** swap to `generateText` — reasoning models (DashScope's `qwq` / Claude reasoning / GLM reasoning, etc.) will time out while emitting reasoning tokens.

### 2. `toolChoice: "auto"`

Reasoning models must use `toolChoice: "auto"`, not `"required"`. With `"required"`, reasoning tokens eat tool-call slots, corrupting output format.

### 3. Inactivity timeouts, not wall-clock timeouts

Tool-call timeouts must be "true timeouts after no output", not mechanical countdowns from launch time. Long-running build / test tool calls are legitimate as long as stdout/stderr keeps flowing. `OPENCORVUS_TOOL_TIMEOUT_MS` controls the **inactivity timeout**. The engine also maintains a separate stream-activity watchdog for LLM streams (180s idle abort).

### 4. Tool-call outputs are JSON strings

All tool `output` fields are **JSON strings** (not objects). Consumers must `JSON.parse`; parse failure → let it crash, no silent fallback.

### 5. Build agent shares the sub-agent protocol

build / intent-analysis / requirements / architect / frontend-design / integrity / prosecutor / delivery all share the structured output contract in `agent/sub-agent-protocol.ts` (Zod tool calls); results are written to `engine_artifact`.

## Doom-loop detection

`session/processor.ts` records tool-call sequences and detects repetition (e.g., the same tool called with identical input 3 times consecutively — `DOOM_LOOP_THRESHOLD = 3`). When triggered, a `doom_loop` permission check fires via `PermissionNext.ask()`; if not approved, the current attempt halts, preventing the agent from burning budget in a dead loop.

## Trace and bus

Every LLM call, tool call / result, and agent boundary is written to `AgentTrace` (`src/trace/`, JSONL appended to `<dir>/.opencorvus/trace/<sessionID>.jsonl` and `_task-<taskID>.jsonl`) and simultaneously broadcast to the overlay SSE via `Bus.publish`. Agent code does not manually call trace; instrumentation is automatic in `session/llm.ts::LLM.stream` + `agent/agent.ts::Agent.generate` + `agent/runner.ts::runAgentSession` + `orchestrator/agent.ts::Orchestrator.processTask`.

## What's next

- [Architecture overview](./architecture.md)
- [Delivery checks and verdict](../opencorvus/evaluator.md)
- [Permissions](../opencorvus/permissions.md)
