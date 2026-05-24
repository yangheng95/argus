import { describe, expect, test } from "bun:test"
import matter from "gray-matter"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { WebpageCompileTool } from "../../src/mirror/tools/webpage-compile"
import { WebpageAnalyzeTool } from "../../src/mirror/tools/webpage-analyze"
import { writeGeneratedSourceFiles } from "../../src/mirror/tools/generated-source"
import webpageGenerateMd from "../../src/skill/builtin/webpage-generate.md" with { type: "text" }
import imageGenerateMd from "../../src/skill/builtin/image-generate.md" with { type: "text" }
import { MIRROR_TOOL_IDS } from "../../src/mirror/tools/ids"

describe("webpage-generate dependency guards", () => {
  test("skill declares design-analysis PRD/SPEC mirror pipeline only", () => {
    const parsed = matter(webpageGenerateMd)
    expect(parsed.data.stage).toBeUndefined()
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
    expect(parsed.content).toContain("mirror/prd-evidence-summary.md")
    expect(parsed.content).toContain("Do not read `mirror/extracted-page.json` wholesale")
    expect(parsed.content).not.toContain("src/App.tsx")
    expect(parsed.content).not.toContain("src/design-tokens.ts")
    expect(parsed.content).toContain("create the mirror evidence package once")
    expect(parsed.content).toContain("stop acquiring mirror evidence")
    expect(parsed.content).not.toContain("Run `webpage_extract`")
    expect(parsed.content).not.toContain("Run `webpage_compile`")
    expect(parsed.content).not.toContain("Run `webpage_analyze`")
    expect(parsed.content).toContain("Do not implement application source")
    expect(parsed.content).not.toMatch(/Tailwind CDN|cdn\.tailwindcss\.com/)
    expect(parsed.content).not.toContain("`webpage_compile_html`")
    expect(parsed.content).not.toContain("single-file static")
    expect(parsed.content).not.toMatch(/\b9[05]\/100\b|\b95\+\b/)
    expect(parsed.content).not.toMatch(/\bbun run dev\b|\bnpm start\b/i)
    expect(parsed.content).not.toMatch(/static mode|Live-server mode/i)
  })

  test("reference generation skills are design-analysis only and never claim acceptance gates", () => {
    for (const md of [webpageGenerateMd, imageGenerateMd]) {
      const parsed = matter(md)
      expect(parsed.data.stage).toBeUndefined()
      expect(parsed.content).toContain("PRD/SPEC")
      expect(parsed.content).toContain("prd_iteration_notes")
      expect(parsed.content).toContain("Build agents consume the persisted PRD/SPEC")
      expect(parsed.content).toContain("visual_consistency_spec")
      expect(parsed.content).toContain("PRD/SPEC working surface")
      expect(parsed.data.description).not.toContain("->")
      expect(parsed.content).not.toContain("## Required Evidence Path")
      expect(parsed.content).not.toMatch(/\bRun `(?:webpage|figma)/)
      expect(parsed.content).toContain("stop acquiring mirror evidence")
      expect(parsed.content).not.toContain("webpage_render url=<explicit")
      expect(parsed.content).not.toContain("webpage_evaluate.passed = true")
      expect(parsed.content).not.toContain("webpage_vision_judge.accepted = true")
      expect(parsed.content).not.toMatch(/\b9[05]\/100\b|\b95\+\b/)
      expect(parsed.content).not.toMatch(/\bbun run dev\b|\bnpm start\b/i)
      expect(parsed.content).not.toMatch(/static mode|Live-server mode|defaults render `<worktree>/i)
      expect(parsed.content).not.toMatch(/overall score\s+\*\*≥\s*95\*\*\s+AND/i)
    }
  })

  test("mirror tool surface does not expose Figma REST tools", () => {
    expect(MIRROR_TOOL_IDS).not.toContain("figma_extract" as any)
    expect(MIRROR_TOOL_IDS).not.toContain("figma_compile" as any)
    expect(MIRROR_TOOL_IDS).not.toContain("figma_analyze" as any)
  })

  test("read_file refuses raw mirror extraction JSON and unbounded dense mirror artifacts", async () => {
    const { createCodebaseTools } = await import("../../src/engine/codebase-tools")
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/mirror/extracted-page.json`, `[{"screenshotUrl":"${"x".repeat(5000)}"}]\n`)
    await Bun.write(
      `${tmp.path}/mirror/scaffold.json`,
      Array.from({ length: 140 }, (_, i) => (i === 0 ? "[" : i === 139 ? "]" : `{"node":${i}}`)).join("\n"),
    )
    await Bun.write(`${tmp.path}/mirror/page-ir.xml`, Array.from({ length: 5 }, (_, i) => `<n>${i}</n>`).join("\n"))

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
    expect(scaffold).toContain("Do not retry this read for general page discovery")
    expect(scaffold).toContain("max_lines <= 120")

    const bounded = await readFile.execute({ path: "mirror/scaffold.json", max_lines: 20 }, {})
    expect(bounded).toContain("1 | [")
    expect(bounded).toContain("bounded mirror artifact excerpt returned")
    expect(bounded).not.toContain("next chunk:")

    const paged = await readFile.execute({ path: "mirror/scaffold.json", start_line: 21, max_lines: 20 }, {})
    expect(paged).toContain("Do not page dense mirror artifacts")

    const pageIr = await readFile.execute({ path: "mirror/page-ir.xml", max_lines: 2 }, {})
    expect(pageIr).toContain("1 | <n>0</n>")
    expect(pageIr).toContain("bounded mirror artifact excerpt returned")
    expect(pageIr).not.toContain("next chunk:")
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

  test("read_file supports paged reads with stable line numbers", async () => {
    const { createCodebaseTools } = await import("../../src/engine/codebase-tools")
    await using tmp = await tmpdir()
    await Bun.write(`${tmp.path}/large.txt`, Array.from({ length: 5 }, (_, i) => `line-${i + 1}`).join("\n"))

    const tools = createCodebaseTools(tmp.path)
    const readFile = tools.read_file as any
    const first = await readFile.execute({ path: "large.txt", max_lines: 2 }, {})
    expect(first).toContain("1 | line-1")
    expect(first).toContain("next chunk: read_file path=\"large.txt\" start_line=3 max_lines=2")

    const second = await readFile.execute({ path: "large.txt", start_line: 3, max_lines: 2 }, {})
    expect(second).not.toContain("line-1")
    expect(second).toContain("3 | line-3")
    expect(second).toContain("4 | line-4")
    expect(second).toContain("start_line=5")
  })

  test("compile and analyze surface an actionable missing-artifact error", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const compile = await WebpageCompileTool.init()
        const analyze = await WebpageAnalyzeTool.init()

        expect(compile.description).toContain("Do not rerun it once `page-ir.xml` exists")
        expect(analyze.description).toContain("Do not rerun it once `shared-context.md`")
        expect(compile.description).not.toContain("Use as step")
        expect(analyze.description).not.toContain("Use as step")
        expect(compile.description).not.toContain("Never batch it in the same assistant turn")
        expect(analyze.description).not.toContain("Never batch it in the same assistant turn")

        await expect(compile.execute({ outputDir: tmp.path }, {} as any)).rejects.toThrow(
          "Create the URL evidence package first and retry only after `extracted-page.json` exists.",
        )
        await expect(analyze.execute({ outputDir: tmp.path }, {} as any)).rejects.toThrow(
          "Create the URL evidence package first and retry only after `extracted-page.json` exists.",
        )
      },
    })
  })

  test("generated source artifacts stay inside mirror output directory", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const outputDir = path.join(tmp.path, "mirror")
        const written = await writeGeneratedSourceFiles(outputDir, [
          {
            file_path: "src/components/TradingViewScreener.tsx",
            code: "export function TradingViewScreener() { return null }\n",
          } as any,
        ])

        const artifactPath = path.join(
          outputDir,
          "generated-source",
          "src",
          "components",
          "TradingViewScreener.tsx",
        )
        expect(written).toEqual([artifactPath])
        expect(await Bun.file(artifactPath).exists()).toBe(true)
        expect(await Bun.file(path.join(tmp.path, "src", "components", "TradingViewScreener.tsx")).exists()).toBe(false)
      },
    })
  })
})
