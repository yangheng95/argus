# Provider-bound helper LLM calls

## Problem

Production helper LLM calls must use the same provider-bound model and schema
normalization path as the main session stream. Several helpers called
`streamText` with a raw `LanguageModel`, or passed raw Zod schemas to
`Output.object` / `tool`, bypassing `ProviderLLM.wrapModel` and
`ProviderTransform.schema`.

## Call-point sweep

| Call point                                          | Current risk                                                           | Decision                                                                                         |
| --------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `src/session/llm.ts`                                | Canonical session path already wraps with `ProviderLLM.wrapModel`.     | Keep.                                                                                            |
| `src/agent/agent.ts` `agent-generate`               | Raw `model: language`; raw `Output.object({ schema: helperSchema })`.  | Wrap model and use provider-bound output schema.                                                 |
| `src/task-api/index.ts` `task-followup`             | Raw `model: language`; raw `Output.object({ schema: z.object(...) })`. | Wrap model and use provider-bound output schema.                                                 |
| `src/acceptance/checks/walkthrough/translate.ts`    | Raw `model: language`; raw walkthrough tool `inputSchema`.             | Resolve the `Provider.Model`, wrap the language model, and use provider-bound tool input schema. |
| `src/server/routes/provider.ts` provider probe      | Raw `model: language` in production endpoint.                          | Wrap model; keep probe-specific timeout and OAuth options.                                       |
| `src/frontend-design/tools/webpage-vision-judge.ts` | Model already wrapped; raw `Output.object({ schema: VerdictSchema })`. | Use provider-bound output schema.                                                                |
| `script/cache-probe/trace-aisdk-wire.ts`            | Raw SDK use.                                                           | Keep. This is a diagnostic script intentionally observing unwrapped wire payloads.               |
| Tests using raw `streamText`                        | Local diagnostics or direct wrapper tests.                             | Keep.                                                                                            |

## Design

Add one provider-layer helper for structured output:

- It accepts a `Provider.Model` and the source Zod schema.
- It converts the Zod schema to JSON Schema, normalizes it through
  `ProviderTransform.schema`, and wraps it with AI SDK `jsonSchema`.
- It keeps Zod validation attached so `result.output` still materializes the
  typed output and rejects invalid provider responses.

Tool schemas continue to use `SessionLoop.providerBoundInputSchema`; the
walkthrough translator uses that existing single source instead of copying
provider transform logic.

## Verification

- Unit tests for provider-bound structured output schema normalization and
  validation.
- Walkthrough translator test proving the submitted tool schema is
  provider-normalized for GPT-compatible models.
- Production source contract test proving `src/` `streamText` call sites do not
  pass raw `model: language`.
