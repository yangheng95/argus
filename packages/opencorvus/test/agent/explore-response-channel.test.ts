/**
 * Regression: the orchestrator-dispatched explore subagent (kimik26 model,
 * task `tsk_e547f0608001sE4ibVP7dmMYhw`) wrote its findings into a
 * `memory.save` value and then, driven by the loop's tool-result echo, the
 * model decided the next input "looks like a system ping with no following
 * user message" and emitted only the literal placeholder text
 * `(Waiting for the actual user message following this system ping — no
 * action required.)` with `finish: "stop"`. The harvest at
 * orchestrator/tools.ts:3462-3465 + loop.ts:1772-1776 (Message.stream is
 * `desc(time_created)`) takes the LATEST assistant message and concatenates
 * its text parts — so the placeholder became the explore tool's return
 * value, the orchestrator interpreted it as failure, and retried the explore
 * dispatch in an infinite loop. The task sat with all workflow steps
 * `pending` for an hour.
 *
 * Two correlated prompt gaps caused this — there was no host bug in the
 * harvest path: it correctly returned the agent's last terminal assistant
 * message per its contract. The fix is purely prompt-side (rule 6.1).
 *
 *   1. `agent/prompt/explore.txt` had no "your response IS the deliverable"
 *      rule; the Memory section encouraged writing findings to memory
 *      immediately without saying memory is not a acceptance channel.
 *   2. The dispatcher's local prompt in `orchestrator/tools.ts` told the
 *      agent to "return concrete findings" but did not say WHERE those
 *      findings must appear, and did not preempt the "system ping"
 *      misreading of continuing tool-result echoes.
 *
 * These tests pin the contract on both sides.
 *
 * Run: bun test test/agent/explore-response-channel.test.ts
 */
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const explorePromptPath = new URL("../../src/agent/prompt/explore.txt", import.meta.url)
const dispatchSourcePath = new URL("../../src/orchestrator/tools.ts", import.meta.url)

const norm = (s: string) => s.replace(/\s+/g, " ")

describe("explore subagent — response channel contract", () => {
  test("explore.txt declares the last assistant turn's text is the only deliverable", async () => {
    const prompt = await Bun.file(explorePromptPath).text()
    const n = norm(prompt)

    expect(prompt).toContain("## Your response IS the deliverable")
    expect(n).toContain("Your text in your last assistant turn is the entire deliverable")
    expect(n).toContain("Tool calls run in a side channel the caller never reads back")
    expect(n).toContain("writing findings into a `memory.save` value")
    expect(n).toContain("The orchestrator harvests only the text parts of your final assistant message")
  })

  test("explore.txt forbids no-op placeholders and pins continuation semantics", async () => {
    const prompt = await Bun.file(explorePromptPath).text()
    const n = norm(prompt)

    expect(n).toContain("your next assistant turn MUST emit findings as plain text")
    expect(n).toContain("Continuing tool-result messages are the SAME task continuing")
    expect(n).toContain("they are not new user requests and they are not system pings")
    expect(n).toContain('Do not output "waiting for user message" / "no action required" placeholders')
    expect(n).toContain("do not treat a tool-result echo as a signal to suspend work")
  })

  test("explore.txt's Memory section names memory as supplementary, not a acceptance channel", async () => {
    const prompt = await Bun.file(explorePromptPath).text()
    const n = norm(prompt)

    expect(n).toContain("Memory is supplementary cross-session retention, not a acceptance channel")
    expect(n).toContain("IN ADDITION to including them in your final text response")
  })

  test("orchestrator's explore dispatch prompt names the response channel explicitly", () => {
    const source = readFileSync(fileURLToPath(dispatchSourcePath), "utf8")
    const n = norm(source)

    expect(n).toContain("Return concrete findings as plain text in your final assistant turn")
    expect(n).toContain("Tool calls (memory.save and any other tool) are a side channel the orchestrator does NOT read back")
    expect(n).toContain("only your last assistant turn's text is delivered")
    expect(n).toContain("continuing tool-result echoes are the same task continuing — not new user requests, not system pings")
  })
})
