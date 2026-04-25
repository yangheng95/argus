import { describe, expect, test } from "bun:test"
import matter from "gray-matter"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { WebpageCompileTool } from "../../src/mirror/tools/webpage-compile"
import { WebpageAnalyzeTool } from "../../src/mirror/tools/webpage-analyze"
import webpageGenerateMd from "../../src/skill/builtin/webpage-generate.md" with { type: "text" }

describe("webpage-generate dependency guards", () => {
  test("skill declares deterministic pipeline and build-required tools", () => {
    const parsed = matter(webpageGenerateMd)
    expect(parsed.data.required_tools).toContain("webpage_compile_html")
    expect(parsed.data.required_tools).toContain("webpage_render")
    expect(parsed.data.required_tools).toContain("webpage_evaluate")
    expect(parsed.content).toContain("Steps 1–2 are **strictly serial**")
    expect(parsed.content).toContain("Do NOT hand-write `index.html` from a screenshot")
    expect(parsed.content).toContain("`webpage_compile_html`")
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