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
  test("skill declares generated React source pipeline and build-required tools", () => {
    const parsed = matter(webpageGenerateMd)
    // Required tools cover extract → compile → analyze (serial), then the
    // render/evaluate/text-diff loop. The deterministic compile-html tool is
    // gone (rule 22 — single-source generation strategy lives in
    // src/mirror/url/prompt.ts) so the skill must NOT name it.
    expect(parsed.data.required_tools).toContain("webpage_extract")
    expect(parsed.data.required_tools).toContain("webpage_compile")
    expect(parsed.data.required_tools).toContain("webpage_analyze")
    expect(parsed.data.required_tools).toContain("webpage_render")
    expect(parsed.data.required_tools).toContain("webpage_evaluate")
    expect(parsed.data.required_tools).toContain("webpage_text_diff")
    expect(parsed.data.required_tools).not.toContain("webpage_compile_html")
    // Content invariants: generated source contract, strictly-serial
    // extract/compile/analyze, no old static-page branch.
    expect(parsed.content).toContain("Generated React source")
    expect(parsed.content).toContain("src/App.tsx")
    expect(parsed.content).toContain("src/design-tokens.ts")
    expect(parsed.content).toContain("Steps 1–3 are **strictly serial**")
    expect(parsed.content).toContain("Refine the generated React source")
    expect(parsed.content).not.toMatch(/Tailwind CDN|cdn\.tailwindcss\.com/)
    expect(parsed.content).not.toContain("`webpage_compile_html`")
    expect(parsed.content).toContain("webpage_render url=<explicit HTTP URL>")
    expect(parsed.content).not.toContain("single-file static")
    expect(parsed.content).toContain("webpage_vision_judge.accepted = true")
    expect(parsed.content).toContain("SINGLE primary acceptance signal")
    expect(parsed.content).not.toMatch(/\bbun run dev\b|\bnpm start\b/i)
    expect(parsed.content).not.toMatch(/static mode|Live-server mode/i)
  })

  test("visual generation skills keep one URL render path and one acceptance signal", () => {
    for (const md of [webpageGenerateMd, imageGenerateMd, figmaGenerateMd]) {
      const parsed = matter(md)
      expect(parsed.content).toMatch(/webpage_render url=<explicit (HTTP )?URL>/)
      expect(parsed.content).toContain("webpage_vision_judge.accepted = true")
      expect(parsed.content).toContain("diagnostic")
      expect(parsed.content).not.toMatch(/\bbun run dev\b|\bnpm start\b/i)
      expect(parsed.content).not.toMatch(/static mode|Live-server mode|defaults render `<worktree>/i)
      expect(parsed.content).not.toMatch(/overall score\s+\*\*≥\s*95\*\*\s+AND/i)
    }
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
