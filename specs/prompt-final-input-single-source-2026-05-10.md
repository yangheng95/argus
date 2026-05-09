# Prompt Final Input Single Source Repair Plan

Date: 2026-05-10

## Problem

The final system prompt sent to LLMs is composed by two independent sources:

1. `LLM.stream` prepends `agent.prompt || core_header`.
2. `runAgentSession` passes a fully-composed stage prompt through `SessionPrompt.prompt({ system })`, which is stored as `lastUser.system`.

Final order today:

```text
(agent.prompt || core_header)
SessionLoop runtime system blocks
lastUser.system
```

This creates three classes of failures:

- Stage agents with registry prompts receive duplicated core prompts.
- Stage agents without registry prompts inherit the generic coding prompt.
- Callers that already own a complete prompt, such as control-plane/refine, are polluted by the default agent prompt.

## Goals

- One final system prompt authority per LLM call.
- Stage runner owns stage prompts.
- Chat/session default agents still get their registered prompts.
- No hidden fallback to `core_header` for stage agents that already supply a complete prompt.
- Invalid agent names fail with a clear error before session messages are persisted.
- Prompt Catalog reflects runtime truth or explicitly labels non-runtime defaults.

## Non-Goals

- Do not rewrite core prompt content.
- Do not add compatibility shims for old prompt paths.
- Do not introduce per-agent ad hoc exceptions.
- Do not parse final prompt strings with keyword heuristics in production.

## Root Cause

`Agent.Info.prompt` currently has two incompatible meanings:

- Runtime default prompt for ordinary SessionPrompt agents.
- Catalog/default prompt metadata for stage agents.

`runAgentSession` already composes the stage prompt from `core`, config append, skills, and task context. But `LLM.stream` cannot tell that `lastUser.system` is complete, so it also prepends `agent.prompt` or `core_header`.

## Repair Design

### 1. Add explicit prompt prelude mode to SessionPrompt

Add a field to `PromptInput`:

```ts
systemMode?: "append_to_agent" | "complete"
```

Semantics:

- `append_to_agent` is the default and preserves ordinary chat behavior.
- `complete` means `input.system` is the complete caller-owned system prompt and `LLM.stream` must not prepend `agent.prompt` or `core_header`.

Persist this on `Message.User`, e.g.:

```ts
systemMode?: "append_to_agent" | "complete"
```

### 2. Make LLM.stream respect system mode

Current:

```ts
const providerPrompt = input.agent.prompt ? [input.agent.prompt] : await SystemPrompt.provider(input.model)
```

Change to:

```ts
const providerPrompt =
  input.user.systemMode === "complete"
    ? []
    : input.agent.prompt
      ? [input.agent.prompt]
      : await SystemPrompt.provider(input.model)
```

Then keep the rest of the composition order unchanged:

```text
providerPrompt
SessionLoop runtime system blocks
input.user.system
```

For `complete`, the final order becomes:

```text
SessionLoop runtime system blocks
complete caller system
```

If runtime blocks must come after the complete prompt for cache or authority reasons, do that as one structural change in `LLM.stream`, not at each caller.

### 3. Route runner calls through complete mode

In `runAgentSession`, set:

```ts
systemMode: "complete"
```

This fixes:

- requirements duplicate core
- architect duplicate core
- design-analyst duplicate core
- intent-analysis duplicate core
- delivery duplicate core
- integrity generic coding prelude leak
- prosecutor generic coding prelude leak
- build double-source prelude, if we decide runner's `BUILD_CORE` is the sole build-stage system prompt

### 4. Decide build's ordinary chat vs build-stage split

`build` currently has:

- ordinary visible default agent prompt: `agent/prompt/build.txt`
- stage build prompt: `prompt/core/build-core.txt`

Keep both roles, but separate semantics:

- Ordinary user chat/default coding sessions use `agent/prompt/build.txt` via `append_to_agent`.
- Orchestrator-dispatched build stage uses `BUILD_CORE` via `complete`.

This removes accidental double-source while preserving the product's default coding chat behavior.

### 5. Fix registry prompt truth

Set `general.prompt = PROMPT_GENERAL` in `Agent.state()`.

For `integrity` and `prosecutor`, do not add runtime prompts just to silence fallback. They are runner-only stage agents and should use `systemMode: "complete"`. Prompt Catalog can still surface their core prompt as metadata if desired, but it must not imply `Agent.Info.prompt` is runtime-used.

### 6. Fix invalid agent handling

In `SessionPrompt.createUserMessage`, after:

```ts
const agent = await Agent.get(input.agent ?? (await Agent.defaultAgent()))
```

add a hard validation:

```ts
if (!agent) {
  throw new Error(`Unknown agent: ${input.agent}`)
}
```

Then fix `orchestrator/tools.ts` refine path:

- Use a real agent with `systemMode: "complete"`, likely `general`, or add a dedicated hidden `refine` agent only if this is a durable product role.
- Preferred: `agent: "general"`, `systemMode: "complete"`, because refine already supplies the full project-analysis prompt and does not need a new registry role.

### 7. Fix control-plane prompt ownership

`control/message.ts` should not use `Agent.defaultAgent()` for prompt prelude.

Use:

```ts
agent: "general",
systemMode: "complete"
```

or introduce a hidden `control` agent only if the UI needs per-agent model configuration. The smaller fix is `general + complete`, because control-plane already resolves its model separately and supplies a complete structured-output system prompt.

### 8. Audit helper LLM calls

Direct `streamText` helper calls are acceptable only if their messages are fully explicit and traceable:

- `agent-generate`: already has explicit system and helper trace.
- task follow-up suggestion: explicit system and helper trace.
- provider health check: explicit minimal probe, not an agent.
- mirror image extraction / vision judge: explicit tool-local prompts; should be recorded as helper LLM calls if AgentTrace is expected to cover all LLM calls.

## Tests

Add focused tests that inspect the final `LLM.stream` input, not just prompt files.

### Unit tests

1. `SessionPrompt.prompt` with `systemMode: "complete"` does not prepend `agent.prompt`.
2. `SessionPrompt.prompt` default mode still prepends `agent.prompt`.
3. Missing `agent` throws `Unknown agent: ...`.
4. `general` has `PROMPT_GENERAL` in runtime registry.

### Runner tests

Mock/intercept `LLM.stream` or `streamText` and assert:

- requirements final system contains requirements core once.
- architect final system contains architect core once.
- delivery final system contains delivery core once.
- integrity final system does not contain `best coding agent`.
- prosecutor final system does not contain `best coding agent`.
- build dispatched by runner contains `BUILD_CORE` and does not prepend `agent/prompt/build.txt`.

### Control/refine tests

- control-plane final system starts from control prompt, not build prompt.
- refine no longer passes `agent: "assistant"`.
- refine prompt reaches LLM without generic coding prelude.

### Prompt Catalog tests

- Catalog and runtime agree for ordinary agents: build, general, explore, compaction, title.
- Stage-agent catalog entries are either hidden from editable runtime prompt UI or explicitly marked as stage-core metadata.

## Migration Steps

1. Add `systemMode` schema + message persistence.
2. Update `LLM.stream` composition.
3. Update `runAgentSession` to pass `complete`.
4. Update refine and control-plane callers.
5. Add `general.prompt`.
6. Add unknown-agent validation.
7. Add final-input tests.
8. Run targeted tests:

```bash
bun test packages/opencorvus/test/agent packages/opencorvus/test/session packages/opencorvus/test/orchestrator
```

9. Run typecheck and route/docs checks before push.

## Acceptance Criteria

- No stage runner agent receives duplicated core prompt.
- No runner-only stage agent inherits `core_header`.
- No control-plane/refine LLM call inherits the build/default agent prompt.
- Unknown agent names fail before message persistence.
- Prompt Catalog no longer disagrees with runtime behavior for visible agents.
- AgentTrace final LLM request records prove the above for at least one test per affected class.
