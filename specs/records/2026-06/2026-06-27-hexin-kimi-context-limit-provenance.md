# Hexin Kimi Context Limit Provenance

## Problem

`hexin/kimi-k2.7-code` failed in a long build session with an internal
`PromptBudgetOverflowError`. The error surfaced `limit=165254`, but that number
was not a provider context limit. It came from local budgeting:

- local profile context: `200000`
- local output reserve: `16384`
- usable budget: `200000 - 16384 = 183616`
- compaction trigger: `floor(183616 * 0.9) = 165254`

That made the UI and logs look like Hexin or Moonshot had a 165k context
boundary. The real provider limit must come from Hexin metadata or a direct
provider overflow response, not from the local compaction threshold.

## Evidence

Authenticated probe on 2026-06-27:

- `GET https://aimemodeldev.myhexin.com/litellm/v1/models`
  - returns only `{ id, object, created, owned_by }` rows.
  - includes `kimi-k2.5`, `kimi-k2.6`, and `kimi-k2.7-code`.
- `GET https://aimemodeldev.myhexin.com/litellm/v1/model/info`
  - returns Hexin/LiteLLM model metadata.
  - `kimi-k2.7-code`:
    - `model_info.key = "kimi-k2.7-code"`
    - `model_info.max_tokens = 262144`
    - `model_info.max_input_tokens = 262144`
    - `model_info.max_output_tokens = 262144`
    - `model_info.supports_vision = true`
    - `model_info.supports_function_calling = true`
    - `model_info.supports_tool_choice = true`
    - `model_info.supports_reasoning = true`
  - `kimi-k2.6` reports the same `262144` values for max/context, max input,
    and max output.

This matches older observed Kimi K2.6 provider overflow text recorded in
`deleted pre-June record 2026-05-13-build-context-spike-empty-snapshot-plan`, where
the provider said `Max Input Tokens=262144`.

## Decision

Update the exact Hexin profiles with provider-reported context metadata:

- `kimi-k2.6`: `context=262144`, `input=262144`, `output=262144`.
- `kimi-k2.7-code`: `context=262144`, `input=262144`, `output=262144`.

Do not treat the local compaction trigger as a provider limit. The trigger
remains a budgeting threshold derived from `ContextBudget`, while profile
limits represent Hexin provider metadata.

Do not generalize this evidence to every `/kimi/i` model. Only exact models
with Hexin metadata or direct provider evidence get exact limits.

## Validation

- Profile unit tests assert the exact context, input, and output limits.
- Hexin discovery tests assert the same `Provider.Model.limit` values after
  catalog materialization.
