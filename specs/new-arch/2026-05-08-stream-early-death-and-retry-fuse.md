# Stream early-death detection and retry circuit breaker

## Evidence

Task `tsk_e078e1f2a001t4ZwUl5SWgoG8o` (2026-05-08 12:26:55 → 12:29:40):

- 1st orchestrator turn: succeeded with `finish="tool-calls"`, called `skill(webpage-generate)` (30847 tokens including skill payload).
- 2nd orchestrator turn: stream early-died after persisting only `[step-start, reasoning(text="")]` into the assistant message. `message.data.finish=null`, `message.data.error=null`.
- From 12:27:16 onward: 277 consecutive `engine_artifact.kind="orchestrator-stream-error"` rows, all with the same payload:
  `APIError: Provider deepseek returned HTTP 400: Invalid assistant message: content or tool_calls must be set`.
- `message` table distribution for the orchestrator session: `user/null:279, assistant/tool-calls:1, assistant/null:279`. Each `monitorRuns → reviveZombieTasks` tick added one user/assistant pair on top of the broken history; provider rejected every replay; loop exited; next tick re-revived.

## Root Cause

Two coupled defects, neither caught locally:

1. `session/message.ts::toModelMessages` only filters out an assistant message when `msg.info.error` is set (and even then keeps `AbortedError` messages that carry tool/text parts). Stream early-death produces a message with `finish=null AND error=null AND parts=[step-start, reasoning(empty)]` — passes the filter, gets serialized to provider as `{role:"assistant", content:"", tool_calls:undefined}`. OpenAI / DeepSeek / any chat-completion provider that follows the public protocol must reject this — assistant messages require either `content` or `tool_calls` to be set.
2. The wedge guard that previously refused revive on `orchestrator-stream-error` was removed in `2026-04-30-llm-activity-first-byte-zombie-loop-fix.md` (correctly — it caused a forever-wedge in autonomous bench mode). Nothing replaced it. When defect (1) makes every replay deterministically fail, `monitorRuns` happily revives the task ~once per second, burning DeepSeek 400s for as long as the operator lets it run.

The previous spec only addressed the LLMActivityPolicy invariant misorder and the "any artifact ever blocks revive" overcorrection. It did not address malformed history persistence or runaway revive on a deterministically failing request.

## Grep Coverage

| Target                                 | Existing call sites / siblings                                                                                                                        | Change                                                                                                                                                                                                                                                             |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `toModelMessages` (assistant branch)   | `src/session/message.ts:752`. Sole reader of session messages → ModelMessage[] for ALL agents (orchestrator, architect, build, mirror, vision-judge). | Add structural validity check after building `assistantMessage.parts`: at least one `text` part with non-empty text OR one `tool-${name}` part. Skip otherwise. Single source — fixes provider replay for every agent type, not just orchestrator.                 |
| `recordOrchestratorStreamError`        | `src/engine/persist.ts:1940` (writer); `src/orchestrator/agent.ts:435` (sole caller).                                                                 | After recording, count stream-error artifacts in last 60s for this task. If `>= 3`, mark the task `failed` with a structured error. Resource-governance fuse, not workflow FSM (rule 13/23). Threshold + window are hardcoded constants — no config knob to drift. |
| `listOrchestratorStreamErrorArtifacts` | `src/engine/store.ts:761`. Existing helper for `describe.ts::recent_stream_failures`.                                                                 | Reuse for the fuse window query.                                                                                                                                                                                                                                   |
| `Message.AbortedError`                 | `src/session/message.ts` (existing skip branch for aborted reasoning-only assistants).                                                                | Untouched. The new check is broader — both error-tagged and silently-broken empty-content turns are filtered.                                                                                                                                                      |
| `reviveZombieTasks`                    | `src/engine/runtime.ts:79`. Wakes any active task with no in-flight loop.                                                                             | Untouched. The fuse marks the task terminal, so `isTaskActive` returns false, so revive naturally stops. No new "if-stream-error-then-skip" guard at the revive layer (avoids repeating the 2026-04-30 wedge regression).                                          |

## Implementation

### `packages/opencorvus/src/session/message.ts`

In the assistant branch of `toModelMessages` (currently lines 752-883), after the per-part loop that builds `assistantMessage.parts`, add:

```ts
// Structural validity gate. The chat-completion contract (OpenAI, DeepSeek,
// vLLM, etc.) requires every assistant message to carry `content` or
// `tool_calls`. A turn whose stream early-died produces only step-start +
// empty reasoning parts; replaying it serializes to `{role:"assistant",
// content:"", tool_calls:undefined}` and the provider returns 4xx, wedging
// the next wake into a deterministic retry loop (orchestrator-stream-error
// artifact storm, 2026-05-08).
const hasProviderVisibleContent = assistantMessage.parts.some(
  (part) =>
    (part.type === "text" && typeof part.text === "string" && part.text.length > 0) ||
    (typeof part.type === "string" && part.type.startsWith("tool-")),
)
if (!hasProviderVisibleContent) continue
```

Keep the existing `if (assistantMessage.parts.length > 0)` push block as-is — it already injects media correctly when `tool` parts exist (which means the validity gate passed).

### `packages/opencorvus/src/orchestrator/agent.ts`

In the `if (streamErrors.length > 0)` branch (lines 427-443), after `recordOrchestratorStreamError(...)`:

```ts
const FUSE_THRESHOLD = 3
const FUSE_WINDOW_MS = 60_000
const { listOrchestratorStreamErrorArtifacts } = await import("@/engine/store")
const recent = listOrchestratorStreamErrorArtifacts(taskID, Date.now() - FUSE_WINDOW_MS, FUSE_THRESHOLD)
if (recent.length >= FUSE_THRESHOLD) {
  log.error("orchestrator stream-error fuse tripped — marking task failed", {
    taskID,
    consecutive: recent.length,
    windowMs: FUSE_WINDOW_MS,
    lastReason: reason,
  })
  const current = requireTask(taskID)
  const { isTaskTerminal } = await import("@/engine/task-status")
  if (!isTaskTerminal(current)) {
    await updateTask(
      current,
      {
        status: "failed",
        error: `Orchestrator stream failed ${recent.length} consecutive times within ${FUSE_WINDOW_MS / 1000}s — last error: ${reason}. Operator must retry or fail_task.`,
      },
      `Stream-error fuse tripped after ${recent.length} consecutive failures`,
    )
  }
}
```

Justification for exception to rule 13/23 ("trust LLM, no engine state machine"): when stream early-dies before any token reaches the orchestrator, the LLM literally cannot decide. Every revive replays the same broken history → same 4xx → same outcome, deterministically. This is resource governance (same family as provider rate-limit), not workflow choreography. The threshold (3 in 60s) intentionally permits transient network/provider blips to self-heal — only a deterministic loop trips the fuse.

### Tests

1. `packages/opencorvus/test/session/message-stream-early-death.test.ts` (new):
   - Build a fixture with assistant message: `finish=null, error=null, parts=[step-start, reasoning("")]`.
   - Assert `toModelMessages` excludes it from the result.
   - Negative case: assistant with one non-empty text part is preserved.
   - Negative case: assistant with one tool part (any state) is preserved.

2. `packages/opencorvus/test/orchestrator/stream-error-fuse.test.ts` (new):
   - Seed task + 2 prior `orchestrator-stream-error` artifacts within 60s.
   - Call the fuse path with a 3rd error.
   - Assert task transitions to `failed` with `time_completed` set and `error` containing "fuse".
   - Negative case: 2 errors within 60s leaves task `active`.
   - Negative case: 3 errors but oldest is 90s ago — only 2 in window, task stays `active`.

## Out of Scope

- The upstream cause of the empty-reasoning early-death (DeepSeek dropping the stream after `<think>` open in a 30k-token request). Even if that were fixed, any future provider-side stream truncation can recur — the structural gate must hold at the conversion boundary regardless.
- Changing `withLLMActivity` retry policy. Single-call retries are already bounded; the loop here is at the **orchestrator wake** layer, not the in-call retry layer.
