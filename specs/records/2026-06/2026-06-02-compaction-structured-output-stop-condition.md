# Compaction Structured Output Stop Condition

## Problem

The overlay benchmark exposed a build-session failure after frontend-design had already completed its evidence exploration. The failing session was interrupted by an internal compaction summary:

- The compaction model called `StructuredOutput`.
- The tool input was malformed JSON, so the tool returned an input-validation error.
- `SessionCompaction.process` stopped immediately because it used `hasToolCall("StructuredOutput")`.
- The model never received the tool error in a follow-up step, despite the prompt instructing it to fix the object and call `StructuredOutput` again.

This is an algorithm bug in compaction loop control, not a generated frontend artifact problem.

## Call-Point Audit

`rg -n "stopWhen: hasToolCall|stopWhen|hasToolCall|process\\(" packages/opencorvus/src/session packages/opencorvus/test/session packages/opencorvus/src/agent`

Relevant result:

- `packages/opencorvus/src/session/compaction.ts` imports `hasToolCall` and passes `stopWhen: hasToolCall("StructuredOutput")`.
- `packages/opencorvus/src/session/loop.ts` uses the normal session structured-output path and does not pass this stop condition.
- `packages/opencorvus/src/session/llm.ts` only forwards `stopWhen` to the AI SDK.
- Processor tests call `processor.process` but do not define this compaction-specific condition.

AI SDK source confirms `hasToolCall` only checks whether the current step called the named tool. It does not check tool success.

## Decision

Replace the compaction stop condition with a compaction-owned condition:

- Stop when the validated handoff has been captured by `onSuccess`.
- Or stop after the existing handoff retry budget is exhausted.

This preserves the natural model/tool feedback loop. A failed `StructuredOutput` call remains visible to the model as a tool error, and the next step can repair the handoff object. If every attempt fails, existing post-process validation records the structured-output payload error.

## Tests

Add a targeted unit test proving:

- A `StructuredOutput` tool call without captured handoff does not stop the compaction loop on the first attempt.
- The retry budget still terminates failed attempts.
- A captured handoff stops immediately.
