import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const loopSource = readFileSync(path.join(import.meta.dir, "../../src/session/loop.ts"), "utf8")

describe("session runtime contract tool surface", () => {
  test("deep-research and fact-check use the exact runtime-contract tool surface", () => {
    const match = /const exactStageAgents = new Set\(\[([\s\S]*?)\]\)/.exec(loopSource)
    expect(match?.[1]).toContain('"deep-research"')
    expect(match?.[1]).not.toContain('"research"')
    expect(match?.[1]).toContain('"fact-check"')
  })

  test("exact runtime contract still requires matching agent identity", () => {
    expect(loopSource).toContain("contract.identity.agentKind === agentName")
  })
})
