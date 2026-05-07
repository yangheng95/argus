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

export const INFORMATION_MISSING_FALLBACK_TEXT = `## INFORMATION MISSING fallback

If this invocation's instructions or task context dropped required
information (retry without reason, goal contract fields absent,
referenced artifact named without payload, "previous attempt failed"
hint with no concrete evidence, etc.), emit ONLY:

<INFORMATION MISSING>
  <item>concrete description of each missing field / signal</item>
</INFORMATION MISSING>

Then stop. No tool calls, no other text, no structured output. Do
NOT guess defaults; do NOT silently proceed. INFORMATION MISSING is
the diagnostic the host wants when context drops in transit.

The host detects this XML block in any agent's stream and IMMEDIATELY
exits the process (fatal signal — the entire run terminates). Use it
ONLY for truly missing required information; not for minor uncertainty
you can resolve from available context. You have ONE emit — enumerate
every missing field in ONE block.`

/**
 * Append the fallback block to a system prompt. Trims trailing whitespace
 * on the input and inserts a blank line so the block always renders as a
 * standalone section regardless of whether the upstream prompt ended with
 * `\n` or not.
 */
export function appendInformationMissingFallback(systemPrompt: string): string {
  return `${systemPrompt.trimEnd()}\n\n${INFORMATION_MISSING_FALLBACK_TEXT}`
}
