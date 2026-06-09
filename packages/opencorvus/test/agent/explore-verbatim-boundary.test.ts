/**
 * Regression: the explore subagent was being used as a verbatim file-dump
 * pipe by build/coding agents doing a faithful C#→TS port. explore.txt's
 * contract is "search & research" — it silently summarized "show every line"
 * requests and labelled them "complete contents", so the caller never got
 * the literal source and re-invoked explore with escalating wording
 * ("FULL content" → "no summarization" → "EXACT code") until the calls
 * aborted / the tool left the toolset. Root cause was two correlated prompt
 * gaps; these tests pin the contract on both sides.
 *
 * Run: bun test test/agent/explore-verbatim-boundary.test.ts
 */
import { describe, expect, test } from "bun:test"

const explorePromptPath = new URL("../../src/agent/prompt/explore.txt", import.meta.url)
const codingPromptPath = new URL("../../src/agent/prompt/coding.txt", import.meta.url)

const norm = (s: string) => s.replace(/\s+/g, " ")

describe("explore subagent — verbatim-dump scope boundary", () => {
  test("explore.txt forbids calling non-empty tool evidence empty", async () => {
    const prompt = await Bun.file(explorePromptPath).text()
    const n = norm(prompt)

    expect(prompt).toContain("## Codebase Exploration")
    expect(n).toContain("Tool evidence discipline")
    expect(n).toContain("A tool result is non-empty when its output contains file paths")
    expect(n).toContain('"Found N matches" with N > 0')
    expect(n).toContain("metadata count > 0")
    expect(n).toContain('Never describe that as "empty", "no results", or "all searches failed"')
    expect(n).toContain("the broad result was non-empty but did not surface the target yet")
    expect(n).toContain(
      "Do not generalize one empty memory search or one wrong glob into a claim that all repository search tools are empty",
    )
    expect(n).toContain("When you have already found concrete source files for the question")
  })

  test("explore.txt declares it returns findings, not file dumps, and must not silently summarize", async () => {
    const prompt = await Bun.file(explorePromptPath).text()
    const n = norm(prompt)

    expect(prompt).toContain("## Scope boundary — you return findings, not file dumps")
    expect(n).toContain("You are NOT a verbatim file-transfer pipe")
    // It must recognize the exact escalation phrases the loop used.
    expect(n).toContain("show every line")
    expect(n).toContain("no truncation / no summarization")
    expect(n).toContain("faithful rewrite/port")
    // It must NOT silently summarize and pass it off as full content.
    expect(n).toContain("do NOT silently summarize them and present the summary as if it were the full contents")
    expect(n).toContain('Never label a summary as "complete contents"')
    // It must redirect the caller to read directly.
    expect(n).toContain("the caller must `read` those files directly in the parent session")
    // It must treat louder re-asks as a routing problem, not try harder.
    expect(n).toContain("restate this boundary rather than trying harder to dump the file")
  })

  test("coding.txt routes verbatim/faithful-port reads to `read`, not the explore subagent", async () => {
    const prompt = await Bun.file(codingPromptPath).text()
    const n = norm(prompt)

    expect(n).toContain("The explore subagent (Task tool) returns research conclusions with targeted snippets")
    expect(n).toContain("it is NOT a verbatim file-transfer pipe")
    expect(n).toContain("porting / transcribing / faithfully rewriting source")
    expect(n).toContain("call `read` directly and paginate large files with `offset`/`limit`")
    expect(n).toContain("Do NOT delegate verbatim-content reads to a subagent")
    // The escalation anti-pattern is named explicitly so the model recognizes it.
    expect(n).toContain("do not re-ask explore with louder wording")
    expect(n).toContain("that is the wrong tool, not a phrasing problem")
  })

  test("the original over-broad explore-routing line is preserved (no double source)", async () => {
    // The carve-out must sit alongside the existing rule, not replace it —
    // structure/context exploration still goes through the Task tool.
    const prompt = await Bun.file(codingPromptPath).text()
    expect(norm(prompt)).toContain(
      "When exploring the codebase to gather context or answer a question that is not a needle query for a specific file/class/function, use the Task tool instead of running search commands directly",
    )
  })
})
