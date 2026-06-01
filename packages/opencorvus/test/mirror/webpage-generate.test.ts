import { describe, expect, test } from "bun:test"
import matter from "gray-matter"
import path from "path"
import fs from "node:fs/promises"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { WebpageCompileTool } from "../../src/mirror/tools/webpage-compile"
import { WebpageAnalyzeTool } from "../../src/mirror/tools/webpage-analyze"
import { writeGeneratedSourceFiles } from "../../src/mirror/tools/generated-source"
import webpageGenerateMd from "../../src/skill/builtin/webpage-generate.md" with { type: "text" }
import imageGenerateMd from "../../src/skill/builtin/image-generate.md" with { type: "text" }
import { MIRROR_TOOL_IDS } from "../../src/mirror/tools/ids"

describe("webpage-generate dependency guards", () => {
  test("skill declares frontend-design template mirror pipeline only", () => {
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

    expect(parsed.content).toContain("frontend template")
    expect(parsed.content).toContain("template_iteration_notes")
    expect(parsed.content).toContain("visual_consistency_contract")
    expect(parsed.content).toContain("completeness_review")
    expect(parsed.content).toContain("mirror/page.ir.json")
    expect(parsed.content).toContain("mirror/assets/manifest.json")
    expect(parsed.content).toContain("mirror/segments.json")
    expect(parsed.content).toContain("mirror/codegen-context.json")
    expect(parsed.content).toContain("mirror/source-skeleton/")
    expect(parsed.content).toContain("mirror/source-skeleton/README.md")
    expect(parsed.content).toContain("mirror/source-ir/component-tree.json")
    expect(parsed.content).toContain("mirror/source-ir/content-model.json")
    expect(parsed.content).toContain("mirror/source-skeleton/index.html")
    expect(parsed.content).toContain("mirror/source-skeleton/critical.css")
    expect(parsed.content).toContain("mirror/source-skeleton/full-source.css")
    expect(parsed.content).toContain("mirror/source-skeleton/used-selectors.json")
    expect(parsed.content).toContain("mirror/source-skeleton/source-skeleton-audit.json")
    expect(parsed.content).toContain("mirror/source-ir/source-quality-audit.json")
    expect(parsed.content).toContain("mirror/visual-surface-candidates.json")
    expect(parsed.content).toContain("mirror/visual-surface-scaffold.json")
    expect(parsed.content).toContain("mirror/prd-evidence-summary.md")
    expect(parsed.content).toContain("web-clone-source/README.md")
    expect(parsed.content).toContain("web-clone-source/web-clone-context.md")
    expect(parsed.content).toContain("web-clone-source/source-skeleton/index.html")
    expect(parsed.content).toContain("web-clone-source/source-skeleton/critical.css")
    expect(parsed.content).toContain("web-clone-source/source-ir/component-tree.json")
    expect(parsed.content).toContain("blueprint-first implementation flow")
    expect(parsed.content).toContain("source skeleton handoff")
    expect(parsed.content).toContain("functional fill")
    expect(parsed.content).toContain("Do not read `mirror/extracted-page.json` or `mirror/capture.html` wholesale")
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

  test("reference generation skills are frontend-design only and never claim acceptance checks", () => {
    for (const md of [webpageGenerateMd, imageGenerateMd]) {
      const parsed = matter(md)
      expect(parsed.data.stage).toBeUndefined()
      expect(parsed.content).toContain("frontend template")
      expect(parsed.content).toContain("template_iteration_notes")
      expect(parsed.content).toMatch(/Build agents consume the persisted(?: frontend design\/replica)? frontend template/)
      expect(parsed.content).toContain("visual_consistency_contract")
      expect(parsed.content).toContain("frontend template working surface")
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
    await Bun.write(`${tmp.path}/mirror/page.ir.json`, Array.from({ length: 5 }, (_, i) => `{"n":${i}}`).join("\n"))

    const tools = createCodebaseTools(tmp.path)
    const readFile = tools.read_file as any

    const raw = await readFile.execute({ path: "mirror/extracted-page.json" }, {})
    expect(raw).toContain("raw mirror extraction JSON")
    expect(raw).toContain("web-clone-source/implementation-blueprint.md")
    expect(raw).toContain("mirror/source-ir/*.json")

    const rawBounded = await readFile.execute({ path: "mirror/extracted-page.json", max_lines: 1 }, {})
    expect(rawBounded).toContain("not a prompt-readable artifact")
    expect(rawBounded).not.toContain("xxxxx")

    const scaffold = await readFile.execute({ path: "mirror/scaffold.json", max_lines: 1000 }, {})
    expect(scaffold).toContain("dense mirror scaffold JSON")
    expect(scaffold).toContain("Do not retry this read for general page discovery")
    expect(scaffold).toContain("frontend design/replica working surface")
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
    expect(pageIr).toContain("web-clone-source/source-ir evidence")
    expect(pageIr).not.toContain("next chunk:")

    const canonicalPageIr = await readFile.execute({ path: "mirror/page.ir.json", max_lines: 2 }, {})
    expect(canonicalPageIr).toContain("1 | {\"n\":0}")
    expect(canonicalPageIr).toContain("bounded mirror artifact excerpt returned")
    expect(canonicalPageIr).not.toContain("next chunk:")
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

        expect(compile.description).toContain("page.ir.json")
        expect(compile.description).toContain("assets/manifest.json")
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

  test("analyze writes source-skeleton and compact template evidence artifacts", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const outputDir = path.join(tmp.path, "mirror")
        await fs.mkdir(outputDir, { recursive: true })
        await Bun.write(
          path.join(outputDir, "capture.html"),
          `<html><body><section class="hero"><h1>Welcome</h1><img src="mirror/images/logo.png" alt="Logo"></section></body></html>`,
        )
        await Bun.write(
          path.join(outputDir, "extracted-page.json"),
          JSON.stringify({
            url: "https://example.test/",
            title: "Example",
            viewport: { width: 1440, height: 900 },
            screenshotUrl: "",
            tree: [
              {
                selector: "section.hero",
                tag: "section",
                role: "hero",
                bounds: { x: 0, y: 0, w: 1440, h: 400 },
                styles: { display: "flex", flexDirection: "column", padding: "24px" },
                children: [
                  {
                    selector: "h1",
                    tag: "h1",
                    bounds: { x: 24, y: 24, w: 400, h: 48 },
                    styles: { fontSize: "32px", fontWeight: "700" },
                    text: "Welcome",
                  },
                  {
                    selector: "img",
                    tag: "img",
                    bounds: { x: 24, y: 96, w: 120, h: 40 },
                    styles: {},
                    imageSrc: "mirror/images/logo.png",
                    imageAlt: "Logo",
                  },
                ],
              },
            ],
            tokens: { colors: {}, fonts: [], customProperties: {} },
            assets: { images: [], icons: [] },
            stats: { totalElements: 3, extractedElements: 3, imageCount: 1, extractionTimeMs: 1 },
          }),
        )

        const compile = await WebpageCompileTool.init()
        await compile.execute({ outputDir }, {} as any)
        const analyze = await WebpageAnalyzeTool.init()
        const result = await analyze.execute({ outputDir }, {} as any)
        expect(await Bun.file(path.join(outputDir, "visual-surface-candidates.json")).exists()).toBe(true)
        expect(await Bun.file(path.join(outputDir, "visual-surface-scaffold.json")).exists()).toBe(true)
        expect(await Bun.file(path.join(outputDir, "segments.json")).exists()).toBe(true)
        expect(await Bun.file(path.join(outputDir, "codegen-context.json")).exists()).toBe(true)
        expect(await Bun.file(path.join(outputDir, "source-skeleton", "index.html")).exists()).toBe(true)
        expect(await Bun.file(path.join(outputDir, "source-skeleton", "styles.css")).exists()).toBe(true)
        expect(await Bun.file(path.join(outputDir, "source-skeleton", "critical.css")).exists()).toBe(true)
        expect(await Bun.file(path.join(outputDir, "source-skeleton", "full-source.css")).exists()).toBe(true)
        expect(await Bun.file(path.join(outputDir, "source-skeleton", "used-selectors.json")).exists()).toBe(true)
        expect(await Bun.file(path.join(outputDir, "source-skeleton", "skeleton-manifest.json")).exists()).toBe(true)
        expect(await Bun.file(path.join(outputDir, "source-skeleton", "source-skeleton-audit.json")).exists()).toBe(true)
        expect(await Bun.file(path.join(outputDir, "source-ir", "component-tree.json")).exists()).toBe(true)
        expect(await Bun.file(path.join(outputDir, "source-ir", "content-model.json")).exists()).toBe(true)
        expect(await Bun.file(path.join(outputDir, "source-ir", "layout-map.json")).exists()).toBe(true)
        expect(await Bun.file(path.join(outputDir, "source-ir", "style-tokens.json")).exists()).toBe(true)
        expect(await Bun.file(path.join(outputDir, "source-ir", "interaction-hints.json")).exists()).toBe(true)
        expect(await Bun.file(path.join(outputDir, "source-ir", "source-quality-audit.json")).exists()).toBe(true)
        const codegenContext = JSON.parse(await Bun.file(path.join(outputDir, "codegen-context.json")).text())
        const skeletonHtml = await Bun.file(path.join(outputDir, "source-skeleton", "index.html")).text()
        const skeletonCss = await Bun.file(path.join(outputDir, "source-skeleton", "critical.css")).text()
        const skeletonAudit = JSON.parse(await Bun.file(path.join(outputDir, "source-skeleton", "source-skeleton-audit.json")).text())
        const sourceQualityAudit = JSON.parse(await Bun.file(path.join(outputDir, "source-ir", "source-quality-audit.json")).text())
        const contentModel = JSON.parse(await Bun.file(path.join(outputDir, "source-ir", "content-model.json")).text())
        const pageIr = JSON.parse(await Bun.file(path.join(outputDir, "page.ir.json")).text())
        expect(codegenContext.purpose).toBe("web-clone-framework-codegen-context")
        expect(codegenContext.sourceIr).toBe("page.ir.json")
        expect(skeletonHtml).toContain('data-reference-image="../reference.png"')
        expect(skeletonHtml).toContain("Welcome")
        expect(skeletonCss).toContain("[data-source-node-id=")
        expect(skeletonAudit.passed).toBe(true)
        expect(sourceQualityAudit.passed).toBe(true)
        expect(contentModel.media.length).toBeGreaterThan(0)
        expect(pageIr.stats.layoutMatchedElements).toBe(3)
        expect(JSON.stringify(pageIr)).toContain('"selector":"section.hero"')
        expect(JSON.stringify(codegenContext)).toContain('"bounds":{"x":0,"y":0,"w":1440,"h":400}')
      },
    })
  })

  test("compile prefers SingleFile archive CSS before falling back to capture HTML", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const outputDir = path.join(tmp.path, "mirror")
        await fs.mkdir(outputDir, { recursive: true })
        await Bun.write(
          path.join(outputDir, "capture.html"),
          `<html><body><main class="runtimeGenerated"><h1>Capture fallback</h1></main></body></html>`,
        )
        await Bun.write(
          path.join(outputDir, "singlefile.html"),
          `<html><head><style>.runtimeGenerated{display:grid;grid-template-columns:1fr 320px}.runtimeGenerated h1{font-size:48px}</style></head><body><main class="runtimeGenerated"><h1>SingleFile source</h1></main></body></html>`,
        )
        await Bun.write(
          path.join(outputDir, "extracted-page.json"),
          JSON.stringify({
            url: "https://example.test/",
            title: "SingleFile CSS",
            viewport: { width: 1440, height: 900 },
            screenshotUrl: "",
            tree: [
              {
                selector: "main.runtimeGenerated",
                tag: "main",
                bounds: { x: 0, y: 0, w: 1440, h: 400 },
                styles: { display: "grid", gridTemplateColumns: "1fr 320px" },
                text: "SingleFile source",
                children: [
                  {
                    selector: "h1",
                    tag: "h1",
                    bounds: { x: 0, y: 0, w: 400, h: 64 },
                    styles: { fontSize: "48px" },
                    text: "SingleFile source",
                  },
                ],
              },
            ],
            tokens: { colors: {}, fonts: [], customProperties: {} },
            assets: { images: [], icons: [] },
            stats: { totalElements: 2, extractedElements: 2, imageCount: 0, extractionTimeMs: 1 },
          }),
        )

        const compile = await WebpageCompileTool.init()
        const compileResult = await compile.execute({ outputDir }, {} as any)
        const analyze = await WebpageAnalyzeTool.init()
        await analyze.execute({ outputDir }, {} as any)

        const pageIr = await Bun.file(path.join(outputDir, "page.ir.json")).text()
        const criticalCss = await Bun.file(path.join(outputDir, "source-skeleton", "critical.css")).text()
        const fullSourceCss = await Bun.file(path.join(outputDir, "source-skeleton", "full-source.css")).text()

        expect(compileResult.output).toContain("singlefile.html")
        expect(pageIr).toContain("SingleFile source")
        expect(pageIr).not.toContain("Capture fallback")
        expect(criticalCss).toContain(".runtimeGenerated")
        expect(criticalCss).toContain("grid-template-columns: 1fr 320px")
        expect(fullSourceCss).toContain("font-size:48px")
      },
    })
  })

  test("compile materializes inline image assets before writing page IR", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const outputDir = path.join(tmp.path, "mirror")
        const inlinePng = "data:image/png;base64,UE5H"
        await fs.mkdir(outputDir, { recursive: true })
        await Bun.write(
          path.join(outputDir, "capture.html"),
          `<html><body><canvas width="64" height="64"></canvas><div class="bg" style="background-image:url('${inlinePng}')"></div></body></html>`,
        )
        await Bun.write(
          path.join(outputDir, "extracted-page.json"),
          JSON.stringify({
            url: "https://example.test/",
            title: "Inline Assets",
            viewport: { width: 320, height: 200 },
            screenshotUrl: inlinePng,
            screenshotAboveFold: inlinePng,
            tree: [
              {
                selector: "canvas",
                tag: "canvas",
                bounds: { x: 0, y: 0, w: 64, h: 64 },
                styles: {},
                imageSrc: inlinePng,
                imageAlt: "canvas capture",
              },
              {
                selector: "div.bg",
                tag: "div",
                bounds: { x: 80, y: 0, w: 64, h: 64 },
                styles: { backgroundImage: `url("${inlinePng}")` },
              },
            ],
            tokens: { colors: {}, fonts: [], customProperties: {} },
            assets: {
              images: [
                { src: inlinePng, alt: "canvas capture" },
                { src: inlinePng, alt: "bg: div" },
              ],
              icons: [],
            },
            stats: { totalElements: 2, extractedElements: 2, imageCount: 2, extractionTimeMs: 1 },
          }),
        )

        const compile = await WebpageCompileTool.init()
        await compile.execute({ outputDir }, {} as any)

        const extracted = await Bun.file(path.join(outputDir, "extracted-page.json")).text()
        const pageIr = await Bun.file(path.join(outputDir, "page-ir.xml")).text()

        expect(extracted).not.toContain("data:image/png;base64")
        expect(pageIr).not.toContain("data:image/png;base64")
        expect(await Bun.file(path.join(outputDir, "page.ir.json")).exists()).toBe(true)
        expect(await Bun.file(path.join(outputDir, "assets", "manifest.json")).exists()).toBe(true)
        expect(pageIr).toContain("images/canvas/canvas-0.png")
        expect(pageIr).toContain("images/background/background-0.png")
        expect(await Bun.file(path.join(outputDir, "screenshots", "full.png")).exists()).toBe(true)
        expect(await Bun.file(path.join(outputDir, "screenshots", "above-fold.png")).exists()).toBe(true)
        expect(await Bun.file(path.join(outputDir, "images", "canvas", "canvas-0.png")).exists()).toBe(true)
        expect(await Bun.file(path.join(outputDir, "images", "background", "background-0.png")).exists()).toBe(true)
      },
    })
  })

  test("analyze materializes the source-skeleton handoff without a generated project", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const outputDir = path.join(tmp.path, "mirror")
        await fs.mkdir(outputDir, { recursive: true })
        await Bun.write(
          path.join(outputDir, "capture.html"),
          `<html><head><style>body{margin:0}.panel{width:240px;height:120px;background:#fff;color:#111}</style></head><body><main class="panel"><h1>Calendar</h1></main></body></html>`,
        )
        await Bun.write(
          path.join(outputDir, "extracted-page.json"),
          JSON.stringify({
            url: "https://example.test/",
            title: "Codegen",
            viewport: { width: 320, height: 200 },
            screenshotUrl: "",
            tree: [
              {
                selector: "main.panel",
                tag: "main",
                bounds: { x: 0, y: 0, w: 240, h: 120 },
                styles: { display: "block", backgroundColor: "rgb(255, 255, 255)" },
                children: [
                  {
                    selector: "h1",
                    tag: "h1",
                    bounds: { x: 0, y: 0, w: 160, h: 40 },
                    styles: { fontSize: "32px" },
                    text: "Calendar",
                  },
                ],
              },
            ],
            tokens: { colors: {}, fonts: [], customProperties: {} },
            assets: { images: [], icons: [] },
            stats: { totalElements: 2, extractedElements: 2, imageCount: 0, extractionTimeMs: 1 },
          }),
        )

        const compile = await WebpageCompileTool.init()
        await compile.execute({ outputDir }, {} as any)
        const analyze = await WebpageAnalyzeTool.init()
        const result = await analyze.execute({ outputDir }, {} as any)

        expect(result.output).toContain("source-skeleton/index.html")
        expect(result.output).toContain("source-ir/component-tree.json")
        expect(result.output).toContain("The source skeleton and semantic source IR are the development handoff")
        expect(await Bun.file(path.join(outputDir, "source-skeleton", "index.html")).exists()).toBe(true)
        expect(await Bun.file(path.join(outputDir, "source-ir", "content-model.json")).exists()).toBe(true)
      },
    })
  })

  test("compile preserves dense SVG path data through the canonical asset graph", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const outputDir = path.join(tmp.path, "mirror")
        const longPath = `M${Array.from({ length: 240 }, (_, i) => `${i} ${i + 1}`).join(" L")}`
        await fs.mkdir(outputDir, { recursive: true })
        await Bun.write(
          path.join(outputDir, "capture.html"),
          `<html><body><main><svg viewBox="0 0 100 100"><path d="${longPath}" fill="#ccc"></path></svg></main></body></html>`,
        )
        await Bun.write(
          path.join(outputDir, "extracted-page.json"),
          JSON.stringify({
            url: "https://example.test/",
            title: "SVG Path",
            viewport: { width: 320, height: 200 },
            screenshotUrl: "",
            tree: [
              {
                selector: "main",
                tag: "main",
                bounds: { x: 0, y: 0, w: 320, h: 200 },
                styles: {},
              },
            ],
            tokens: { colors: {}, fonts: [], customProperties: {} },
            assets: { images: [], icons: [] },
            stats: { totalElements: 1, extractedElements: 1, imageCount: 0, extractionTimeMs: 1 },
          }),
        )

        const compile = await WebpageCompileTool.init()
        await compile.execute({ outputDir }, {} as any)

        const pageIr = await Bun.file(path.join(outputDir, "page.ir.json")).text()
        const manifest = JSON.parse(await Bun.file(path.join(outputDir, "assets", "manifest.json")).text())
        const svgPathAsset = manifest.assets.find((asset: { kind: string }) => asset.kind === "svg-path-data")

        expect(pageIr).toContain("svg")
        expect(pageIr).toContain("path")
        expect(pageIr).not.toContain(longPath)
        expect(svgPathAsset.semanticRole).toBe("svg-geometry")
        expect(await Bun.file(path.join(outputDir, svgPathAsset.path)).text()).toBe(longPath)
      },
    })
  }, 30_000)

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
          "generated-view-source",
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

  test("generated source subdir cannot escape mirror output directory", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const outputDir = path.join(tmp.path, "mirror")
        const files = [
          {
            file_path: "src/components/TradingViewScreener.tsx",
            code: "export function TradingViewScreener() { return null }\n",
          } as any,
        ]

        await expect(writeGeneratedSourceFiles(outputDir, files, "..")).rejects.toThrow(
          "Generated source artifact subdir cannot escape output directory",
        )
        await expect(writeGeneratedSourceFiles(outputDir, files, path.join(tmp.path, "outside"))).rejects.toThrow(
          "Generated source artifact subdir must be relative",
        )
      },
    })
  })
})
