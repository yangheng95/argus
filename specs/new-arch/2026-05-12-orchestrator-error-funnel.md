# Orchestrator Startup-Error Funnel — Audit & Fix Plan

**Date**: 2026-05-12
**Trigger**: Task `tsk_e1b3234a8001SGOqn3tPnY2cxK` failed in 1.05s with
`Orchestrator error: ProviderModelNotFoundError({providerID:"alibaba-coding-plan-cn", modelID:"kimi-k2.5", suggestions:[]})`.
The user reported the error was being swallowed (rule violation). This document
catalogs every model-resolution / orchestrator-startup error path, identifies
the violation, and proposes a fix.

> Reviewer (codex): the question is — at `orchestrator/agent.ts:178-185` and
> `:479-514`, does the proposed fix correctly unify the error funnel through
> `recordOrchestratorStreamError` without losing the "missing-config is
> terminal" semantics, and without violating rule 8 (single source) or rule 13
> (no state machines)?

---

## 1. Background: the two single-source mechanisms

| Channel                                   | Single-source helper                                                                                           | Consumer                                                                                    | Rule                                                         |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Structured error → next-wake LLM decision | `engine/persist.ts::recordOrchestratorStreamError` (writes `engine_artifact kind="orchestrator-stream-error"`) | `engine/describe.ts:427::listOrchestratorStreamErrorArtifacts` → next wake's describe block | rule 23 — LLM reads facts, decides retry/restart/fail itself |
| Structured retry fuse                     | `engine/persist.ts::maybeTripOrchestratorStreamErrorFuse`                                                      | Same orchestrator wake; trips → permits `updateTask({status:'failed'})` once                | rule 23 — explicit fuse, not implicit FSM                    |

The reference implementation is `orchestrator/agent.ts:434-477` (stream-error
mid-wake handling). Notably **it does NOT call `updateTask({status:"failed"})`**
— the comment at lines 429-431 explicitly forbids that:

> Per rule 23 we do NOT transition the task to `failed` here AND we do NOT
> auto-rewake — both are state-machine reactions.

The terminal-fail only happens when the fuse trips (consecutive consecutive
stream errors within a window).

---

## 2. Audit: every `resolveAgentModel` / `Provider.defaultModel` / `Provider.getModel` call site

Output of `grep resolveAgentModel`, `grep Provider.defaultModel`,
`grep Provider.getModel`, and targeted reads of the remaining callers across
`packages/opencorvus/src`.

### 2.1 Pattern A — preserve `NamedError.data`, surface it, rethrow (**conformant**)

| Site                                | Behavior                                                                                                                                             |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session/loop.ts:1606-1617`         | catches `ModelNotFoundError`, reads `e.data.{providerID,modelID,suggestions}`, publishes `Session.Event.Error` with structured payload, **rethrows** |
| `session/command-exec.ts:106-118`   | same shape — destructures `e.data`, `Bus.publish`, rethrow                                                                                           |
| `session/prompt/command.ts:120-129` | converts `ModelNotFoundError.data` into a structured `NamedError.Unknown(...).toObject()` for the prompt surface                                     |

Structural property: **the `NamedError` payload survives the boundary** so
downstream (CLI / server / overlay / prompt assembly) can act on real fields
instead of grepping flat strings.

### 2.2 Pattern B — wrap with cause preserved (**conformant**)

| Site                      | Behavior                                                                                                                                                                                  |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent/runner.ts:570-587` | catches model-resolution error, stores it as `modelResolutionError`, throws `AgentRunError(..., { cause: modelResolutionError })`; the original instance stays reachable through `.cause` |

### 2.3 Pattern C — strict propagation, no swallow (**conformant by omission**)

| Site                                           | Effect                                                                                                   |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| retired acceptance review provider setup          | bubbled raw `Provider.getModel` failure to orchestrator acceptance flow                                    |
| `orchestrator/tools.ts:4791` (`refine`)        | bubbles raw `resolveAgentModel` failure to the tool caller                                               |
| `control/message.ts:224-230`                   | `Provider.defaultModel()` is intentionally uncaught; missing config stays operator-visible               |
| `session/wake.ts:101-103`                      | wake loop `resolveModel()` returns `Provider.defaultModel()` raw; no local swallow                       |
| `session/shell-exec.ts:52-55`                  | shell resume path resolves `Provider.defaultModel()` raw when `input.model` and `agent.model` are absent |
| `agent/agent.ts:510-511`                       | `generate()` resolves `Provider.defaultModel()` then `Provider.getModel()` raw                           |
| `cli/cmd/debug/agent.ts:73-74`                 | debug tool listing uses `Provider.defaultModel()` raw                                                    |
| `cli/cmd/debug/agent.ts:117-118`               | debug tool execution context uses `Provider.defaultModel()` raw                                          |
| `mirror/tools/webpage-image-extract.ts:66-69`  | mirror image extract resolves configured/default model raw                                               |
| `mirror/tools/webpage-vision-judge.ts:147-150` | mirror vision judge resolves configured/default model raw                                                |
| `session/prompt/title.ts:35`                   | title generation resolves model raw                                                                      |
| `task-api/index.ts:1596`                       | follow-up summary model resolves raw                                                                     |

These are fine: they either intentionally surface the error to their caller or
defer policy to a higher boundary.

### 2.4 Pattern D — optional lookup with selective swallow (**real violation at `parts.ts:92`**)

| Site                            | Current behavior                                                                                              | Verdict                                                                                                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session/prompt/parts.ts:89-93` | optional variant lookup does `Provider.getModel(...).catch(() => undefined)` before computing `agent.variant` | **Violation** — literal swallow of every error class. The lookup is optional, but only `ModelNotFoundError` is legitimately ignorable; provider init / registry / I/O failures must surface. |

### 2.5 Pattern E — orchestrator task-error boundary (**real violation at `orchestrator/agent.ts`**)

| Site                            | Current behavior                                                                              | Verdict                                                                                                                                                               |
| ------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `orchestrator/agent.ts:178-185` | startup catch logs `e.message`, writes flat `engine_task.error`, marks task `failed`, returns | **Violation** — the first-wake terminal contract is correct and must stay, but `.message` extraction drops `NamedError.data` (`providerID`, `modelID`, `suggestions`) |
| `orchestrator/agent.ts:479-514` | outer catch logs `error.message`, writes flat `engine_task.error` when task is non-terminal   | **Violation** — this boundary should continue using `engine_task.error` for non-stream exceptions, but it also drops `NamedError.data`                                |

---

## 3. Why this matters concretely (the 2026-05-12 task)

DB facts collected from `engine_task` / `engine_artifact` / `protocol_event`:

- `task.created` at `1778572735660` → `task.failed` at `1778572736709` (1.05s)
- 0 goals, 0 plan_version, 0 runs, 0 goal_run_attempts
- 0 `orchestrator-stream-error` artifacts
- 0 child sessions, 0 messages, 0 parts
- `engine_task.error` = `"Orchestrator error: ProviderModelNotFoundError: {…}"`

Funnel confirmed: site 1 fired, wrote the flat string, terminal-failed the task,
and skipped the artifact. The structured error never reached any boundary that
could surface `suggestions` (which were `[]` — itself a bigger signal: the
provider registry was entirely empty, meaning the suggestion-fuzzysort fed an
empty list. That secondary issue is out of scope for this spec; see follow-up
note).

---

## 4. Revised fix plan

### 4.1 Preserve first-wake fast-fail exactly where it already belongs

`orchestrator/agent.ts:178-185` is **not** a stream error. It happens before
the orchestrator session starts, before any stream exists, and before the LLM
could read a describe block. The correct behavior is still:

- fail the task on the first wake,
- emit the existing `task.updated` failure event,
- never call `SessionPrompt.prompt`.

What changes is only the **shape** of `engine_task.error`: instead of a flat
string derived from `.message`, write a task-visible string that still begins
with `Orchestrator error: ...` for backward-compatible substring matching, and
append a parseable JSON envelope carrying:

```json
{
  "errorName": "ProviderModelNotFoundError",
  "message": "ProviderModelNotFoundError: {...}",
  "data": {
    "providerID": "...",
    "modelID": "...",
    "suggestions": ["..."]
  }
}
```

That preserves the existing terminal contract while making `NamedError.data`
recoverable for new consumers.

### 4.2 Keep stream artifacts stream-only; do not broaden or double-write

`recordOrchestratorStreamError` and
`maybeTripOrchestratorStreamErrorFuse` stay unchanged in scope:

- **No** new `orchestrator-stream-error` artifact writes for startup failures or
  other non-stream exceptions.
- **No** second `updateTask({ status: "failed" })` after the fuse —
  `maybeTripOrchestratorStreamErrorFuse` already mutates the task when it trips.

The orchestrator outer catch at `:479-514` continues to use `engine_task.error`
for non-stream exceptions; it just stops flattening away `NamedError.data`.

### 4.3 Add a single serializer/parser for orchestrator task errors

Introduce one helper in `orchestrator/agent.ts` that:

- derives `errorName`, `message`, and optional `data` from `unknown`,
- serializes them into a deterministic envelope appended to
  `engine_task.error`,
- exposes a parser so future consumers can recover structure without
  reimplementing ad-hoc string splitting.

The retry note path should read the parsed envelope and reuse the plain
`message`, so a retried task does not echo the raw JSON blob back into the
wake note.

### 4.4 Fix `session/prompt/parts.ts` to swallow only `ModelNotFoundError`

The `agent.variant` lookup is optional, but only in one narrow sense: if the
configured model is absent from the registry, we can continue with
`variant = undefined`. Any other failure class means the registry / provider
pipeline itself is broken and must surface.

Implementation:

- replace `.catch(() => undefined)` with `.catch((error) => { ... })`,
- `log.warn(...)` for every caught failure,
- return `undefined` only when `Provider.ModelNotFoundError.isInstance(error)`,
- rethrow every other error class unchanged.

### 4.5 Tests (rule 36)

| Test                                                                      | Assertion                                                                                                                                                                                      |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/orchestrator/startup-error-envelope.test.ts` (new)                  | startup `Provider.ModelNotFoundError` still fast-fails the task, still never enters `SessionPrompt.prompt`, and `engine_task.error` exposes a parseable envelope with `errorName/message/data` |
| `test/orchestrator/missing-model-fast-fail.test.ts` (existing, unchanged) | first-wake missing-config terminal behavior remains intact                                                                                                                                     |
| `test/session/prompt-parts-model-resolution.test.ts` (new)                | `createUserMessage()` swallows only `Provider.ModelNotFoundError` during optional variant lookup and rethrows a generic error class                                                            |
| `test/provider/default-model.test.ts` (already updated)                   | default model assertion remains `deepseek/deepseek-v4-pro`                                                                                                                                     |

### 4.6 Related companion fix (already applied)

`packages/opencorvus/src/config/config.ts:43` — `DEFAULT_MODEL` changed from
`"alibaba-coding-plan-cn/kimi-k2.5"` to `"deepseek/deepseek-v4-pro"` because the
operator has unsubscribed from the alibaba coding plan. `default-model.test.ts`
updated to match. This is a separate concern from the error funnel but bundled
in the same PR because they were diagnosed together.

---

## 5. Scope intentionally NOT included

- **Full removal of `alibaba-coding-plan-cn` from the codebase** — 121 files,
  the operator opted for the minimal "just change the default" path. The
  provider registration, the `webpage-vision-judge` special-case, and the
  `channel-runtime/dashscope` proxy remain available for anyone who has the
  key. Revisit if/when the operator wants the full purge.
- **The secondary signal `suggestions: []`** — empty array means the provider
  registry itself was empty at the moment of resolution, which is a separate
  bug (provider-state initialization may have failed silently or the running
  binary predates a provider-loading fix; see memory note
  `reference_opencorvus_deployment_model.md`). To be investigated under a
  separate spec.
- **Sites in Pattern C (no try/catch)** — they propagate the structured error
  correctly; no fix needed.

---

## 6. Reviewer checklist (for codex)

1. Does the serializer keep the missing-model fast-fail contract intact while
   making `NamedError.data` recoverable from `engine_task.error`?
2. Does the revised `parts.ts` branch swallow only the optional
   `ModelNotFoundError` case and rethrow everything else?
3. Are any additional consumers of `task.error` worth teaching about the new
   parser in a follow-up, or is the current compatibility prefix sufficient for
   this fix set?
