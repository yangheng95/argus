# Bedrock Claude Assistant Tail Normalization

## Problem

Hexin LiteLLM routes `claude-sonnet-4-6-v2` to Bedrock Anthropic. Architect sessions fail on the second turn after a successful tool-calling turn:

```text
ValidationException: This model does not support assistant message prefill. The conversation must end with a user message.
```

Read-only DB inspection for task `tsk_e88560cc1001zPAGf4pkxKdAbT` showed each failing Architect session has:

```text
user delegation -> assistant finish=tool-calls -> assistant APIError
```

Replaying the first two messages through `Message.toModelMessages()` produced this tail:

```text
assistant tool-call
tool tool-result
assistant text-only narration
```

The final assistant text is local narration after tool results. Bedrock Claude treats that final assistant message as assistant prefill and rejects the request before generation, so LiteLLM records a zero-token HTTP 400 row.

## Grep Evidence

- `packages/opencorvus/src/session/message.ts`
  - `Message.toModelMessages()` converts stored assistant tool parts and text into AI SDK `ModelMessage[]`.
  - It currently filters empty/broken assistant messages but does not enforce provider-specific tail rules.
- `packages/opencorvus/src/session/loop.ts`
  - `processTurn()` builds `baseModelMessages` via `Message.toModelMessages()` and sends them through `LLM.stream()`.
- `packages/opencorvus/src/session/llm.ts`
  - `ProviderLLM.wrapModel()` applies `ProviderTransform.message()` only for stream requests before the SDK serializes provider payloads.
- `packages/opencorvus/src/provider/transform.ts`
  - `ProviderTransform.message()` is the single production message normalization entry point.
- `packages/opencorvus/src/provider/vendor-messages.ts`
  - Existing vendor-specific message transforms live here. Claude currently only sanitizes tool call IDs.
- `packages/opencorvus/test/provider/request-body-contract.test.ts`
  - Existing provider contract tests already cover Bedrock/Hexin Claude and request-shape behavior.

## Decision

Add a Claude-specific message normalizer in `provider/vendor-messages.ts` that removes only a final text-only assistant message when it directly follows tool results.

This is not a fallback and not a routing gate. It is a provider request-shape normalization:

- It applies before the SDK sends the request.
- It is scoped to Claude-like model IDs.
- It only affects the exact invalid tail shape `tool -> assistant(text-only)`.
- It preserves normal assistant history and the required `assistant tool-call -> tool result` exchange.

## Tests

Add provider contract tests for:

- Hexin Claude OpenAI-compatible messages with `assistant tool-call -> tool result -> assistant text` normalize to end at the tool result.
- Earlier assistant text history is preserved when it is not the invalid tail.
- Non-Claude OpenAI-compatible providers keep the same tail.

