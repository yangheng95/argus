# Provider transform message purity

## Problem

`ProviderTransform.message()` is the provider-bound request transform used by
`ProviderLLM.wrapModel`. The Anthropic cache marker step mutates the input
`ModelMessage[]` by writing `providerOptions` on selected messages or content
parts. That leaks provider-only request state back into caller-owned session
messages and makes repeated transforms order-dependent.

This fix is scoped to purity only. It does not change the existing cache
breakpoint placement strategy documented by `cache-stability.test.ts` H5.

## Call-point sweep

| Call point                                          | Decision                                                                                                                      |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `src/provider/llm.ts`                               | Continues to call `ProviderTransform.message()` for every wrapped stream. The transform must not mutate `args.params.prompt`. |
| `src/session/llm.ts`                                | Canonical session stream passes model messages through the wrapper; no call-site change.                                      |
| `src/agent/agent.ts`                                | Helper stream now uses the wrapper from the previous fix; benefits from pure transform.                                       |
| `src/task-api/index.ts`                             | Helper stream now uses the wrapper from the previous fix; benefits from pure transform.                                       |
| `src/acceptance/checks/walkthrough/translate.ts`    | Helper stream now uses the wrapper from the previous fix; benefits from pure transform.                                       |
| `src/server/routes/provider.ts`                     | Probe stream now uses the wrapper from the previous fix; benefits from pure transform.                                        |
| `src/frontend-design/tools/webpage-vision-judge.ts` | Already wrapped; benefits from pure transform.                                                                                |
| `test/frontend-design/cache-stability.test.ts`      | Keep H5 behavior documentation; add separate purity coverage in provider transform tests.                                     |

## Design

Make `applyCaching` return cloned messages only for selected cache-marker
targets:

- Preserve unchanged message object identity for untouched messages.
- Clone a touched message before adding message-level `providerOptions`.
- Clone the last content part before adding content-part `providerOptions`.
- Never mutate caller-owned `msg`, `msg.content`, or nested content part
  objects.

## Verification

- Add a provider transform test with frozen Anthropic input messages and content
  parts, proving `ProviderTransform.message()` does not throw and leaves the
  source messages byte-identical.
- Keep existing cache marker coverage tests to ensure the provider-bound output
  still contains the expected markers.
