# Delivery Prompt Budget Fix — 2026-05-02

## Problem

DeliveryAgent was sending a large single-turn evidence prompt to the provider. Session-level predictive compaction can shrink prior conversation history, but it cannot shrink a fresh user prompt that already contains delivery evidence, manifest details, upstream context, operator notes, mirror context, executor reports, and diffs.

The failing provider response was:

```text
Range of input length should be [1, 258048]
```

This is a context overflow class, not a retryable transport error.

The immediate reason no local compaction caught it: `session/loop.ts` estimates text as `chars / 4` tokens and compares that estimate against `model.limit.input || model.limit.context`. The Alibaba Coding Plan endpoint enforces an input-length ceiling near 258k characters for this model. A 260k-character request is only estimated locally as about 65k tokens, far below the 90% predictive threshold for a 262k catalog context, so the request reaches the provider and fails there.

## Decision

Use the existing provider model limit as the single source of truth:

- `model.limit.input`, when present.
- `model.limit.context`, otherwise.
- no hard-coded provider-specific limits in DeliveryAgent.

DeliveryAgent now budgets its own prompt sections before calling the runner. Required protocol text remains intact. Evidence sections are rendered in priority order, with auxiliary sections capped or omitted when the prompt budget is exhausted.

## Section Priority

1. Required protocol/task/evidence-facet instructions.
2. Goals, delivery summary, manifest gate, host hard gate evidence.
3. Runtime and visual failure evidence.
4. Executor reports and code diffs.
5. Upstream context, mirror context, operator notes, memory context.

When a section is truncated, the prompt includes a `Prompt Truncation Notice` so the DeliveryAgent does not treat omitted auxiliary text as complete.

## Non-Goals

- Do not skip DeliveryAgent when manifest gate fails.
- Do not add an LLM summarizer before DeliveryAgent.
- Do not add provider-specific prompt limits outside the provider model catalog.
