/**
 * INFORMATION MISSING fallback — debug-only prompt block + helper.
 *
 * When `EngineConfig.debug.fail_on_information_missing` is true the host
 * appends this block to every agent's system prompt and runs the matching
 * detection in `agent/runner.ts` (see `messageHasInformationMissing` /
 * `extractInformationMissingBlock`). On detection the host process.exits
 * with code 99 so the operator immediately sees that upstream context
 * dropped instead of a long log of guessed-default work.
 *
 * Single-source: this file owns the prompt text. Prompt files
 * (`packages/opencorvus/src/prompt/core/*-core.txt`) deliberately do
 * NOT carry the fallback section; the host injects it at runtime when
 * the toggle is on, strips it (by not appending) when off. Toggle is
 * exposed via overlay GeneralPanel → PATCH /config → opencorvus.jsonc.
 *
 * Spec / origin: 2026-05-07 INFORMATION MISSING debug toggle. Pinned via
 * `test/agent/information-missing-fallback.test.ts` (constant text +
 * helper) and `test/agent/information-missing-detection.test.ts`
 * (host-side detection helpers).
 */

export const INFORMATION_MISSING_FALLBACK_TEXT = `## INFORMATION MISSING fallback (debug toggle ON — guessing is FORBIDDEN)

This invocation runs with the operator's debug toggle ON. The
operator wants to surface every place the dispatcher chain dropped
context — not "best-effort" output. Your job is INVERTED from
default agent behaviour: you must emit the diagnostic block whenever
you would otherwise GUESS, INFER, or FILL FROM CONVENTION. Helpful
extrapolation is the bug here, not a feature.

Emit IMMEDIATELY when ANY of these are true:

- The orchestrator/parent re-dispatched you with no \`request\` /
  \`reason\` / \`feedback\` field, or those fields are empty / generic
  ("retry", "try again", "fix it"). A bare retry signal is a context
  drop; the dispatcher should have named the failure mode.
- A goal contract field that the prompt structurally references is
  missing or empty — acceptance_specs[] empty, owned_paths[] empty
  when files_changed[] is required, depends_on[] missing when the
  prompt says "those goals are merged into your worktree base".
- The prompt names an artifact (image, screenshot, reference URL,
  attachment://<sha>, prior acceptance feedback, decision_log entry,
  spec line, file path) but the actual payload is absent.
- The prompt says "previous attempt failed" / "rejection feedback" /
  "acceptance rejection" but no concrete error / failure_class /
  expected_fix / category is provided.
- You are about to write or call a tool with a value (color,
  dimension, copy text, model ID, env var name, file path, route,
  config key, version pin, regex, schema field) that the prompt
  did NOT state explicitly, and you'd be inferring from convention,
  training data, prior projects, common practice, or "obvious" sense.
- You are about to call a tool whose required argument you cannot
  fill verbatim from prompt content — even if the missing argument
  is "minor" or has a "reasonable default".

Format — emit ONLY this and stop:

<INFORMATION MISSING>
  <item>missing field: name. referenced where: location in the prompt that named it (or "structurally implied by tool X / contract Y"). would have guessed: the value you were about to pick.</item>
</INFORMATION MISSING>

No tool calls. No prose. No structured output. No apology. No
"let me proceed anyway". Stop after the block.

Permission rules — these CLOSE the helpful-bias loophole:

- "I can fill this from convention / common sense / training data /
  prior project memory" → **EMIT THE BLOCK**. Convention is a guess.
  The toggle exists precisely to surface convention-fill.
- "I can read the file / re-fetch the URL / search code to resolve" →
  **EMIT THE BLOCK**. Ad-hoc resolution masks the dispatcher drop.
  The dispatcher should have provided the field; if it didn't, that
  is the bug we want to see.
- "It's a minor field, the result will be fine" → **EMIT**. The
  toggle is binary; minor missing fields are still missing.
- "If I don't proceed the run dies" → **EMIT ANYWAY**. A run that
  exits with a named missing field is a SUCCESS for the toggle's
  purpose; a run that completes with silent guesses is the FAILURE
  mode this toggle was built to detect. Do not weigh "keep the run
  going" against emission.
- "But the user clearly meant X" → if the prompt didn't say X
  literally, **EMIT**. Inferring user intent is exactly the failure
  mode under audit.

The host detects \`<INFORMATION MISSING>\` in your stream and
process.exits the run with code 99. That is the desired outcome.
You have ONE emit — enumerate every missing field in ONE block.`

/**
 * Append the fallback block to a system prompt. Trims trailing whitespace
 * on the input and inserts a blank line so the block always renders as a
 * standalone section regardless of whether the upstream prompt ended with
 * `\n` or not.
 */
export function appendInformationMissingFallback(systemPrompt: string): string {
  return `${systemPrompt.trimEnd()}\n\n${INFORMATION_MISSING_FALLBACK_TEXT}`
}
