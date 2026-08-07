# 2026-06-11 Hexin Qwen Thinking Profile

## Problem

Hexin `qwen3.7-max` returns HTTP 400 when `tool_choice` is `required` or a pinned tool object in thinking mode. The session loop already avoids forced `toolChoice` for models with `capabilities.reasoning = true`, but Hexin Qwen profiles currently fall through to the generic Qwen matcher with `reasoning: false`.

## Call Points Checked

| Surface                                                    | Evidence                                                                                                                    | Decision                                                   |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `packages/opencorvus/src/provider/hexin-profiles.ts`       | `profileFor()` is the single capability source for Hexin discovery.                                                         | Add a dedicated `qwen3.7-max` matcher before generic Qwen. |
| `packages/opencorvus/src/provider/hexin-discovery.ts`      | `buildModel()` copies `profile.reasoning` into `model.capabilities.reasoning`.                                              | No discovery logic change.                                 |
| `packages/opencorvus/src/session/loop.ts`                  | `terminalToolChoice()` and `structuredOutputToolChoice()` already use `capabilities.reasoning` to avoid forced tool choice. | No loop change.                                            |
| `packages/opencorvus/src/session/llm.ts`                   | Passes computed `toolChoice` to `streamText`.                                                                               | No LLM call change.                                        |
| `packages/opencorvus/test/provider/hexin-profiles.test.ts` | Existing profile contract tests cover Kimi and GLM thinking models.                                                         | Extend tests with Qwen profile coverage.                   |

## Scope

Only mark `qwen3.7-max` as a Hexin reasoning model. Keep existing Qwen context/output defaults because this change is about provider request compatibility, not token limit discovery.
