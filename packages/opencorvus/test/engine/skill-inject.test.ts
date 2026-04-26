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

  test("aggregates required_tools across auto-detected build skills for webpage tasks", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // webpage-generate.md declares `{ has_attachment_image: true,
        // request_contains_url: true }`. Under AND-of-explicit signal
        // semantics (the matcher honors every declared signal — `false`
        // is a real "must not"), both must hold for the skill to fire.
        const result = await resolveStageSkills([], "build", {
          request_contains_url: true,
          has_attachment_image: true,
          request_text: "复刻 https://www.baidu.com/ — 附图为目标视觉",
        })
        expect(result.requiredTools).toContain("webpage_extract")
        expect(result.requiredTools).toContain("webpage_compile")
        expect(result.requiredTools).toContain("webpage_analyze")
        expect(result.requiredTools).toContain("webpage_render")
        expect(result.requiredTools).toContain("webpage_evaluate")
        expect(result.requiredTools).toContain("webpage_text_diff")
        expect(result.requiredTools).not.toContain("webpage_compile_html")
        expect(result.prompt).toContain("Skill-system invariants")
        expect(result.prompt).toContain("Skill: webpage-generate")
      },
    })
  })

  test("image-only request fires image-generate WITHOUT cross-firing webpage-generate", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // image-generate.md declares `{ has_attachment_image: true,
        // request_contains_url: false }`. Webpage-generate also lists
        // has_attachment_image: true but additionally requires url=true,
        // so AND-of-explicit excludes it from this signal set.
        const result = await resolveStageSkills([], "build", {
          has_attachment_image: true,
          request_contains_url: false,
          request_text: "复刻附图所示页面（无 URL，仅截图）",
        })
        const skillNames = result.skills.map((s) => s.name)
        expect(skillNames).toContain("image-generate")
        expect(skillNames).not.toContain("webpage-generate")
        expect(result.requiredTools).toContain("webpage_image_extract")
        expect(result.requiredTools).toContain("webpage_image_compile")
        expect(result.requiredTools).not.toContain("webpage_extract")
      },
    })
  })

  test("URL+image fires webpage-generate but not image-generate (its url=false vetoes)", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await resolveStageSkills([], "build", {
          has_attachment_image: true,
          request_contains_url: true,
          request_text: "复刻 https://example.com/ — 附图作为视觉参考",
        })
        const skillNames = result.skills.map((s) => s.name)
        expect(skillNames).toContain("webpage-generate")
        expect(skillNames).not.toContain("image-generate")
      },
    })
  })

  test("does not auto-detect webpage-generate from frontend files alone", async () => {
    await using tmp = await tmpdir()
    const fs = await import("node:fs/promises")
    const path = await import("node:path")
    await fs.writeFile(
      path.join(tmp.path, "package.json"),
      JSON.stringify({ name: "frontend", dependencies: { react: "^18.0.0", vite: "^5.0.0" } }),
    )
    await fs.writeFile(path.join(tmp.path, "index.html"), "<div id=\"root\"></div>")
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await resolveStageSkills([], "build", {
          request_text: "Implement the account settings page",
        })
        expect(result.skills.map((skill) => skill.name)).not.toContain("webpage-generate")
        expect(result.requiredTools).toEqual([])
      },
    })
  })
})
