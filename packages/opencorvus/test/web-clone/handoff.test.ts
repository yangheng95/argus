import { describe, expect, test } from "bun:test"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"
import {
  buildWebCloneHandoff,
  extractArchiveHtml,
  mergeExtractedLayoutIntoPageIr,
  WebCloneCodegenContextSchema,
  WebCloneSegmentsSchema,
  writeWebCloneHandoff,
} from "../../src/web-clone"

describe("web-clone handoff", () => {
  test("segments structure IR into LLM codegen chunks with asset references", async () => {
    const longPath = `M${Array.from({ length: 200 }, (_, i) => `${i} ${i + 1}`).join(" L")}`
    const extraction = extractArchiveHtml({
      html: `<html><body>
        <header><a href="/home">Home</a></header>
        <main><section><h1>Markets</h1><svg><path d="${longPath}"></path></svg></section></main>
      </body></html>`,
      title: "Markets",
    })

    const handoff = buildWebCloneHandoff(extraction.pageIr, extraction.assetGraph)

    expect(() => WebCloneSegmentsSchema.parse(handoff.segments)).not.toThrow()
    expect(() => WebCloneCodegenContextSchema.parse(handoff.codegenContext)).not.toThrow()
    expect(handoff.segments.segments.map((segment) => segment.tag)).toEqual(["header", "main"])
    expect(handoff.codegenContext.rules.join("\n")).toContain("Do not inline long CSS")
    const main = handoff.segments.segments.find((segment) => segment.tag === "main")
    expect(main?.strategy).toBe("svg-inline")
    expect(main?.assetIds.length).toBe(1)
    expect(main?.assetRefs[0]?.semanticRole).toBe("svg-geometry")
    expect(main?.nodeOutline.some((node) => node.tag === "h1" && node.text === undefined)).toBe(true)
    expect(main?.textPreview).toContain("Markets")
  })

  test("carries layout-aware segment bounds into codegen context", () => {
    const extraction = extractArchiveHtml({
      html: `<html><body><main><section class="panel">Economic calendar</section></main></body></html>`,
    })
    extraction.pageIr = mergeExtractedLayoutIntoPageIr(extraction.pageIr, {
      tree: [
        {
          selector: "main",
          tag: "main",
          bounds: { x: 0, y: 0, w: 1200, h: 720 },
          styles: { display: "grid", gridTemplateColumns: "1fr 320px" },
          children: [
            {
              selector: "section.panel",
              tag: "section",
              bounds: { x: 16, y: 20, w: 820, h: 500 },
              styles: { display: "block" },
              text: "Economic calendar",
            },
          ],
        },
      ],
    })

    const handoff = buildWebCloneHandoff(extraction.pageIr, extraction.assetGraph)
    const main = handoff.codegenContext.segments.find((segment) => segment.tag === "main")

    expect(main?.bounds).toEqual({ x: 0, y: 0, w: 1200, h: 720 })
    expect(main?.layout?.styles?.gridTemplateColumns).toBe("1fr 320px")
    expect(main?.nodeOutline.some((node) => node.tag === "section" && node.layout?.bounds?.w === 820)).toBe(true)
    expect(handoff.codegenContext.rules.join("\n")).toContain("primary geometry source")
    expect(handoff.codegenContext.rules.join("\n")).toContain("bounded source-code generation plan")
  })

  test("selects nested major layout regions instead of one anonymous page shell", () => {
    const extraction = extractArchiveHtml({
      html: `<html><body><div id="root"><div class="app"><header>Top</header><main>Body</main><aside>Rail</aside></div></div></body></html>`,
    })
    extraction.pageIr = mergeExtractedLayoutIntoPageIr(extraction.pageIr, {
      tree: [
        {
          selector: "#root",
          tag: "div",
          bounds: { x: 0, y: 0, w: 1280, h: 720 },
          styles: { display: "block" },
          children: [
            {
              selector: ".app",
              tag: "div",
              bounds: { x: 0, y: 0, w: 1280, h: 720 },
              styles: { display: "grid" },
              children: [
                {
                  selector: "header",
                  tag: "header",
                  bounds: { x: 0, y: 0, w: 1280, h: 64 },
                  styles: { display: "flex" },
                  text: "Top",
                },
                {
                  selector: "main",
                  tag: "main",
                  bounds: { x: 0, y: 64, w: 960, h: 656 },
                  styles: { display: "block" },
                  text: "Body",
                },
                {
                  selector: "aside",
                  tag: "aside",
                  bounds: { x: 960, y: 64, w: 320, h: 656 },
                  styles: { display: "block" },
                  text: "Rail",
                },
              ],
            },
          ],
        },
      ],
    })

    const handoff = buildWebCloneHandoff(extraction.pageIr, extraction.assetGraph)

    expect(handoff.segments.segments.map((segment) => segment.tag)).toEqual(["div"])
    expect(handoff.segments.segments[0]?.layout?.selector).toBe(".app")
    expect(handoff.segments.segments[0]?.nodeOutline.map((node) => node.tag).filter(Boolean)).toContain("main")
  })

  test("writes segments and codegen context artifacts", async () => {
    await using tmp = await tmpdir()
    const extraction = extractArchiveHtml({ html: "<html><body><main>Hello</main></body></html>" })
    const handoff = buildWebCloneHandoff(extraction.pageIr, extraction.assetGraph)
    await writeWebCloneHandoff(path.join(tmp.path, "webpage-evidence"), handoff)

    expect(await Bun.file(path.join(tmp.path, "webpage-evidence", "segments.json")).exists()).toBe(true)
    expect(await Bun.file(path.join(tmp.path, "webpage-evidence", "codegen-context.json")).exists()).toBe(true)
  })
})
