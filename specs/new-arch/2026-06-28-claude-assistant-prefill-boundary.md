# Claude Assistant Prefill Boundary

Date: 2026-06-28

## Problem

Hexin `cy-claude-sonnet-4-6` can route to an Anthropic-compatible backend that
rejects assistant message prefill:

```text
This model does not support assistant message prefill. The conversation must end with a user message.
```

The LiteLLM fallback text is secondary. Its configured fallback groups use
`claude-sonnet-4-6`, while this request uses `cy-claude-sonnet-4-6`, so no
fallback group is selected. OpenCorvus must still fix the request shape; model
fallback is not a valid repair.

## Recall

- `2026-06-02-bedrock-claude-assistant-tail-normalization.md` fixed only the
  `assistant tool-call -> tool result -> assistant text` local narration tail.
- `2026-05-21-build-retry-session-reuse-runtime-contract.md` introduced
  `SessionRuntimeContract` and the `orchestrator-wake` runtime contract.
- `2026-06-25-scheduler-orchestrator-auto-compaction.md` keeps
  `orchestrator-wake` as the live scheduler continuation source.

## Grep Inventory

Command:

```text
rg -n 'assistantPrefill|prefill|runOnce|orchestrator-wake|MAX_STEPS|role: "assistant" as const|role: "assistant"|ProviderTransform\.message|normalizeVendorMessages|toModelMessages|LLM\.stream\(' packages/opencorvus/src packages/opencorvus/test specs/new-arch -S
```

Relevant call sites:

| Surface | Decision |
| --- | --- |
| `packages/opencorvus/src/provider/llm.ts` | Keep `ProviderTransform.message()` as the single provider-bound message transform. |
| `packages/opencorvus/src/provider/vendor-messages.ts` | Replace the narrow Claude tool-result-only tail drop with the no-prefill tail contract in Claude vendor logic. |
| `packages/opencorvus/src/session/loop.ts` | Stop appending local `MAX_STEPS` as an assistant message. It is runtime instruction, not prior assistant content. |
| `packages/opencorvus/src/session/loop.ts` runtime `runOnce` | Internal wakes may run without a new persisted user message, so provider transform must protect the request tail. |
| `packages/opencorvus/src/orchestrator/agent.ts` | Existing `orchestrator-wake` contract remains the live tool/runtime source; do not add hidden user messages or fallback routing. |
| `packages/opencorvus/test/provider/request-body-contract.test.ts` | Add no-prefill request contract tests. |
| `packages/opencorvus/test/session/runtime-contract-wake.test.ts` | Assert internal wake provider input no longer ends in assistant for no-prefill models. |

## Decision

Claude-like providers that do not support assistant prefill must not receive a
request whose final model message is `assistant`.

This is enforced in two layers:

1. Producer repair: `MAX_STEPS` becomes a system/runtime instruction instead
   of an appended assistant message.
2. Provider boundary: Claude message normalization removes only the invalid
   final text-only assistant tail. It preserves non-tail assistant history and
   preserves assistant tool-call messages paired with tool results.

This is not fallback logic and not a routing gate. It is provider request-shape
normalization at the existing provider boundary.

## Acceptance

- Hexin Claude drops a final text-only assistant tail even when it is not
  directly preceded by a tool message.
- Claude keeps `user -> assistant -> user` history.
- Claude keeps `assistant tool-call -> tool result` history.
- Non-Claude OpenAI-compatible providers keep assistant tails.
- Session loop no longer sends local max-step instruction as assistant prefill.
- Internal `orchestrator-wake` replay for a no-prefill Claude model does not
  send an assistant-final provider request.
