# Agentic loop

The executor internals follow the **standard agentic loop**: LLM emits tool-call → tool executes → result fed back → next turn. This page covers the three states, tool routing, and the key invariants.

## Three states

`SessionLoop` (`packages/opencorvus/src/session/loop.ts:50`) is always in one of:

| State | Meaning | Exit |
|---|---|---|
| **standby** | assistant emitted `finish`; waiting for the next user message | new user message arrives |
| **tool-call** | LLM requested tools; they're executing | all tools resolved |
| **subtask** | current turn spawned a sub-agent (recursive call) | sub-task completes |

`collectLoopState` scans the last user/assistant pair; if the assistant's `finishReason !== "tool-calls"` and no new user message is queued → standby.

## Tool routing

Each tool-call returned by the LLM is routed by `SessionToolResolver` (`src/session/tool-resolver.ts`):

1. **Filter** — `resolveTools()` applies the `input.tools` allow-list so DashScope isn't bombarded with 30+ tools.
2. **Permission check** — `PermissionNext.ask()` (see [Permissions](../opencorvus/permissions.md)).
3. **Execute** — dispatch to the tool handler.
4. **Write back** — the result becomes a `tool-result` part on the session message stream.

## Sub-tasks

`TaskTool` spawns sub-tasks that recurse into a new SessionLoop via `runSubtask` (`src/session/loop.ts:88`). This supports arbitrary nesting: main agent → research sub-agent → …

## Outer loop wiring

`runTaskLoop` (`src/orchestrator/task-loop.ts:59`) injects prompts through the MirrorCode executor (`OpencodeExecutor.submit`, `src/executor/opencode.ts:48`):

```
Orchestrator.runTaskLoop
  └─ TaskAgent.processTask      (LLM decision)
      └─ MirrorCode executor (inject prompt)
          └─ TaskQueueService.runNow
              └─ SessionLoop     (inner agentic loop)
```

## Key invariants

### 1. Must use `streamText`, never `generateText`

The LLM call in `session/loop.ts` uses Vercel AI SDK's `streamText`. **Do not** swap to `generateText` — reasoning models (DashScope `qwq`, Claude reasoning, o1) will time out while emitting reasoning tokens.

### 2. `toolChoice: "auto"`

Reasoning models must use `toolChoice: "auto"`, not `"required"`. With `required`, reasoning tokens eat tool-call slots, corrupting output.

### 3. Stall-based timeouts, not wall-clock timeouts

Tool-call timeouts are **inactivity timeouts** — long-running build/test calls are fine as long as stdout/stderr keeps flowing. `OPENCORVUS_TOOL_TIMEOUT_MS` controls this. Wall-clock timeouts are wrong.

### 4. Tool-call outputs are JSON strings

Tool `output` fields are **JSON strings**, not objects. Consumers must `JSON.parse`. Parse failure → let it crash. No silent fallback.

## Doom-loop detection

`tool/gui-state.ts` records tool-call sequences and detects repetition (e.g. 5 identical clicks at the same coordinate). When triggered, the Run is marked `stuck`; Evaluator returns `inconclusive`, which replans instead of retries — avoiding dead-loop budget burn.

## What's next

- [Architecture](./architecture.md)
- [Evaluator](../opencorvus/evaluator.md)
- [Permissions](../opencorvus/permissions.md)
