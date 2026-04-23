import { describe, expect, test } from "bun:test"
import matter from "gray-matter"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { WebpageCompileTool } from "../../src/mirror/tools/webpage-compile"
import { WebpageAnalyzeTool } from "../../src/mirror/tools/webpage-analyze"
import webpageCloneMd from "../../src/skill/builtin/webpage-clone.md" with { type: "text" }

describe("webpage-clone dependency guards", () => {
  test("skill explicitly requires serial extract/compile/analyze steps", () => {
    const parsed = matter(webpageCloneMd)
    expect(parsed.content).toContain("## Critical Dependency Rule")
    expect(parsed.content).toContain("Steps 1-3 are **strictly serial**")
    expect(parsed.content).toContain("Never call `webpage_compile` or `webpage_analyze` in the same response as `webpage_extract`")
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