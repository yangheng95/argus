import { describe, expect, test } from "bun:test"
import { resolveStageSkills } from "../../src/engine/skill-inject"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("resolveStageSkills", () => {
  test("always prepends the stage invariant for delivery, even with zero skills matched", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await resolveStageSkills([], "delivery", undefined)
        expect(result.prompt).toContain("Skill-system invariants")
        expect(result.prompt).toContain("tool_call_evidence")
      },
    })
  })

  test("produces empty prompt for stages without invariants when no skill matched", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await resolveStageSkills([], "no-such-stage", undefined)
        expect(result.prompt).toBe("")
        expect(result.skills).toEqual([])
        expect(result.requiredTools).toEqual([])
      },
    })
  })

  test("empty-string prompt when stage omitted and no matches", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await resolveStageSkills([], undefined, undefined)
        expect(result.prompt).toBe("")
      },
    })
  })

  test("aggregates required_tools across auto-detected delivery skills when project matches", async () => {
    await using tmp = await tmpdir()
    const fs = await import("node:fs/promises")
    const path = await import("node:path")
    // Create a minimal react project so the built-in delivery-verify-web auto-detect
    // matches on the deps signal.
    await fs.writeFile(
      path.join(tmp.path, "package.json"),
      JSON.stringify({ name: "t", dependencies: { react: "^18.0.0" } }),
    )
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await resolveStageSkills([], "delivery", undefined)
        // The built-in delivery-verify-web skill declares these tools.
        expect(result.requiredTools).toContain("verify_page_integrity")
        expect(result.requiredTools).toContain("screenshot")
        // Invariant section still present alongside the matched skill.
        expect(result.prompt).toContain("Skill-system invariants")
        expect(result.prompt).toContain("Skill: delivery-verify-web")
      },
    })
  })
})
