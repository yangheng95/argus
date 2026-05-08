import { describe, expect, test } from "bun:test"
import { deriveUrlSignals, resolveStageSkills } from "../../src/engine/skill-inject"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

describe("deriveUrlSignals", () => {
  test("partitions figma URLs out of the generic URL signal", () => {
    expect(deriveUrlSignals("复刻 https://www.figma.com/design/abc/title")).toEqual({
      request_contains_url: false,
      request_contains_figma_url: true,
    })
    expect(deriveUrlSignals("clone https://example.com/")).toEqual({
      request_contains_url: true,
      request_contains_figma_url: false,
    })
    expect(deriveUrlSignals("纯文本 — 无 URL")).toEqual({
      request_contains_url: false,
      request_contains_figma_url: false,
    })
  })

  test("text containing both a figma URL and another URL splits cleanly", () => {
    const out = deriveUrlSignals(
      "Mockup at https://www.figma.com/file/xyz, also see https://example.com/spec",
    )
    expect(out.request_contains_figma_url).toBe(true)
    expect(out.request_contains_url).toBe(true)
  })

  test("recognises figma proto / board / design / file paths", () => {
    for (const path of ["file", "design", "proto", "board"]) {
      expect(
        deriveUrlSignals(`https://figma.com/${path}/abc/x`).request_contains_figma_url,
      ).toBe(true)
    }
  })

  test("undefined / empty input is fully false", () => {
    expect(deriveUrlSignals(undefined)).toEqual({
      request_contains_url: false,
      request_contains_figma_url: false,
    })
    expect(deriveUrlSignals("")).toEqual({
      request_contains_url: false,
      request_contains_figma_url: false,
    })
  })
})

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

  test("webpage reference skill belongs to design_analyst, not build", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const build = await resolveStageSkills([], "build", {
          request_contains_url: true,
          request_text: "复刻 https://www.baidu.com/",
        })
        expect(build.skills.map((s) => s.name)).not.toContain("webpage-generate")
        expect(build.requiredTools).toEqual([])

        const design = await resolveStageSkills([], "design_analyst", {
          request_contains_url: true,
          request_text: "复刻 https://www.baidu.com/",
        })
        expect(design.requiredTools).toContain("webpage_extract")
        expect(design.requiredTools).toContain("webpage_compile")
        expect(design.requiredTools).toContain("webpage_analyze")
        expect(design.requiredTools).not.toContain("webpage_render")
        expect(design.prompt).toContain("Design-analysis is the only stage")
        expect(design.prompt).toContain("Skill: webpage-generate")
      },
    })
  })

  test("plain code build receives only the build invariant and no forced skills", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await resolveStageSkills([], "build", {
          request_text: "Build a TypeScript calculator with tokenizer tests",
          has_attachment_image: false,
          request_contains_url: false,
          request_contains_figma_url: false,
        })
        expect(result.prompt).toContain("Skill-system invariants")
        expect(result.skills).toEqual([])
        expect(result.requiredTools).toEqual([])
      },
    })
  })

  test("image-only request fires image-generate in design_analyst only", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const build = await resolveStageSkills([], "build", {
          has_attachment_image: true,
          request_contains_url: false,
          request_text: "复刻附图所示页面（无 URL，仅截图）",
        })
        expect(build.skills.map((s) => s.name)).not.toContain("image-generate")

        const result = await resolveStageSkills([], "design_analyst", {
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
        const result = await resolveStageSkills([], "design_analyst", {
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

  test("URL-only reference fires webpage-generate", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await resolveStageSkills([], "design_analyst", {
          has_attachment_image: false,
          request_contains_url: true,
          request_text: "Clone https://example.com/",
        })
        const skillNames = result.skills.map((s) => s.name)
        expect(skillNames).toContain("webpage-generate")
        expect(skillNames).not.toContain("image-generate")
      },
    })
  })

  test("figma URL routes to ONLY figma-generate (not webpage-generate, not image-generate)", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Figma URL routes via deriveUrlSignals to
        // { request_contains_url: false, request_contains_figma_url: true }.
        //   - figma-generate fires on figma_url=true.
        //   - image-generate vetoes on figma_url=true.
        //   - webpage-generate fails the url=true gate (url is false here).
        // Each skill independently declares its own constraint; no cross-skill
        // coordination in their frontmatter.
        const build = await resolveStageSkills([], "build", {
          has_attachment_image: true,
          ...deriveUrlSignals("复刻 https://www.figma.com/design/abc/title"),
          request_text: "复刻 https://www.figma.com/design/abc/title",
        })
        expect(build.skills.map((s) => s.name)).not.toContain("figma-generate")

        const result = await resolveStageSkills([], "design_analyst", {
          has_attachment_image: true,
          ...deriveUrlSignals("复刻 https://www.figma.com/design/abc/title"),
          request_text: "复刻 https://www.figma.com/design/abc/title",
        })
        const skillNames = result.skills.map((s) => s.name)
        expect(skillNames).toContain("figma-generate")
        expect(skillNames).not.toContain("webpage-generate")
        expect(skillNames).not.toContain("image-generate")
        expect(result.requiredTools).toContain("figma_extract")
        expect(result.requiredTools).toContain("figma_compile")
        expect(result.requiredTools).toContain("figma_analyze")
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

  test("research-report auto-detects report-shaped work without loading on ordinary code tasks", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const report = await resolveStageSkills([], "build", {
          request_text: "写一份多模型平台能力对比调研报告，包含建议和矩阵",
        })
        expect(report.skills.map((skill) => skill.name)).toContain("research-report")
        expect(report.requiredTools).toContain("websearch")

        const code = await resolveStageSkills([], "build", {
          request_text: "Implement OAuth callback handling and unit tests",
        })
        expect(code.skills.map((skill) => skill.name)).not.toContain("research-report")
      },
    })
  })
})
