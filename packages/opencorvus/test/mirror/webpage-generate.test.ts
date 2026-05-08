import { describe, expect, test } from "bun:test"
import matter from "gray-matter"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { WebpageCompileTool } from "../../src/mirror/tools/webpage-compile"
import { WebpageAnalyzeTool } from "../../src/mirror/tools/webpage-analyze"
import webpageGenerateMd from "../../src/skill/builtin/webpage-generate.md" with { type: "text" }
import imageGenerateMd from "../../src/skill/builtin/image-generate.md" with { type: "text" }
import figmaGenerateMd from "../../src/skill/builtin/figma-generate.md" with { type: "text" }

describe("webpage-generate dependency guards", () => {
  test("skill declares design-analysis PRD/SPEC mirror pipeline only", () => {
    const parsed = matter(webpageGenerateMd)
    expect(parsed.data.stage).toBe("design_analyst")
    expect(parsed.data.required_tools).toContain("webpage_extract")
    expect(parsed.data.required_tools).toContain("webpage_compile")
    expect(parsed.data.required_tools).toContain("webpage_analyze")
    expect(parsed.data.required_tools).not.toContain("webpage_render")
    expect(parsed.data.required_tools).not.toContain("webpage_evaluate")
    expect(parsed.data.required_tools).not.toContain("webpage_text_diff")
    expect(parsed.data.required_tools).not.toContain("webpage_vision_judge")
    expect(parsed.data.required_tools).not.toContain("webpage_compile_html")

    expect(parsed.content).toContain("PRD/SPEC")
    expect(parsed.content).toContain("prd_iteration_notes")
    expect(parsed.content).toContain("visual_consistency_spec")
    expect(parsed.content).toContain("completeness_review")
    expect(parsed.content).toContain("mirror/scaffold.json")
    expect(parsed.content).toContain("Do not read `mirror/extracted-page.json` wholesale")
    expect(parsed.content).not.toContain("src/App.tsx")
    expect(parsed.content).not.toContain("src/design-tokens.ts")
    expect(parsed.content).toContain("The extraction steps are strictly serial")
    expect(parsed.content).toContain("Do not implement application source")
    expect(parsed.content).not.toMatch(/Tailwind CDN|cdn\.tailwindcss\.com/)
    expect(parsed.content).not.toContain("`webpage_compile_html`")
    expect(parsed.content).not.toContain("single-file static")
    expect(parsed.content).not.toMatch(/\b9[05]\/100\b|\b95\+\b/)
    expect(parsed.content).not.toMatch(/\bbun run dev\b|\bnpm start\b/i)
    expect(parsed.content).not.toMatch(/static mode|Live-server mode/i)
  })

  test("reference generation skills are design-analysis only and never claim delivery gates", () => {
    for (const md of [webpageGenerateMd, imageGenerateMd, figmaGenerateMd]) {
      const parsed = matter(md)
      expect(parsed.data.stage).toBe("design_analyst")
      expect(parsed.content).toContain("PRD/SPEC")
      expect(parsed.content).toContain("prd_iteration_notes")
      expect(parsed.content).toContain("Build agents consume the persisted PRD/SPEC")
      expect(parsed.content).toContain("visual_consistency_spec")
      expect(parsed.content).toContain("PRD/SPEC working surface")
      expect(parsed.content).not.toContain("webpage_render url=<explicit")
      expect(parsed.content).not.toContain("webpage_evaluate.passed = true")
      expect(parsed.content).not.toContain("webpage_vision_judge.accepted = true")
      expect(parsed.content).not.toMatch(/\b9[05]\/100\b|\b95\+\b/)
      expect(parsed.content).not.toMatch(/\bbun run dev\b|\bnpm start\b/i)
      expect(parsed.content).not.toMatch(/static mode|Live-server mode|defaults render `<worktree>/i)
      expect(parsed.content).not.toMatch(/overall score\s+\*\*≥\s*95\*\*\s+AND/i)
    }
  })

  test("read_file refuses raw mirror extraction JSON and unbounded dense mirror artifacts", async () => {
    const { createCodebaseTools } = await import("../../src/engine/codebase-tools")
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/mirror/extracted-page.json`, `[{"screenshotUrl":"${"x".repeat(5000)}"}]\n`)
    await Bun.write(`${tmp.path}/mirror/scaffold.json`, "[\n{}\n]\n")

    const tools = createCodebaseTools(tmp.path)
    const readFile = tools.read_file as any

    const raw = await readFile.execute({ path: "mirror/extracted-page.json" }, {})
    expect(raw).toContain("raw mirror extraction JSON")
    expect(raw).toContain("mirror/page-ir.xml")

    const rawBounded = await readFile.execute({ path: "mirror/extracted-page.json", max_lines: 1 }, {})
    expect(rawBounded).toContain("not a prompt-readable artifact")
    expect(rawBounded).not.toContain("xxxxx")

    const scaffold = await readFile.execute({ path: "mirror/scaffold.json", max_lines: 1000 }, {})
    expect(scaffold).toContain("dense mirror scaffold JSON")

    const bounded = await readFile.execute({ path: "mirror/scaffold.json", max_lines: 20 }, {})
    expect(bounded).toContain("1 | [")
  })

  test("read_file truncates pathological long text lines", async () => {
    const { createCodebaseTools } = await import("../../src/engine/codebase-tools")
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/notes.txt`, `${"a".repeat(2000)}\n`)

    const tools = createCodebaseTools(tmp.path)
    const readFile = tools.read_file as any
    const output = await readFile.execute({ path: "notes.txt", max_lines: 1 }, {})

    expect(output).toContain("line truncated")
    expect(output.length).toBeLessThan(1400)
  })

  test("compile and analyze surface an actionable missing-artifact error", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const compile = await WebpageCompileTool.init()
        const analyze = await WebpageAnalyzeTool.init()

        expect(compile.description).toContain("Never batch it in the same assistant turn as `webpage_extract`")
        expect(analyze.description).toContain("Never batch it in the same assistant turn as `webpage_extract`")

        await expect(compile.execute({ outputDir: tmp.path }, {} as any)).rejects.toThrow(
          "Run `webpage_extract` first and wait for it to finish before calling `webpage_compile`.",
        )
        await expect(analyze.execute({ outputDir: tmp.path }, {} as any)).rejects.toThrow(
          "Run `webpage_extract` first and wait for it to finish before calling `webpage_analyze`.",
        )
      },
    })
  })
})
