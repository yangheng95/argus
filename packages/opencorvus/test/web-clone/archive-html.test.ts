import { describe, expect, test } from "bun:test"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"
import {
  extractArchiveHtml,
  writeWebCloneArchiveExtraction,
  WebCloneAssetGraphSchema,
  WebClonePageIrSchema,
} from "../../src/web-clone"

describe("web-clone archive HTML extraction", () => {
  test("preserves structure while moving dense CSS, SVG, and data URIs to the asset graph", async () => {
    const longPath = `M${Array.from({ length: 260 }, (_, i) => `${i}.${i} ${i + 1}.${i + 2}`).join(" L")}`
    const html = `<!doctype html>
<html>
  <head>
    <style>.hero{display:grid;color:#111}${".x{margin:0}".repeat(80)}</style>
  </head>
  <body>
    <main class="page shell" data-page="economy">
      <a href="https://example.test/report">Report</a>
      <svg viewBox="0 0 100 100"><path d="${longPath}" fill="#ddd"></path></svg>
      <img src="data:image/png;base64,UE5HREFUQQ==" alt="inline">
    </main>
  </body>
</html>`

    const extraction = extractArchiveHtml({ html, url: "https://example.test", title: "Example" })

    expect(() => WebClonePageIrSchema.parse(extraction.pageIr)).not.toThrow()
    expect(() => WebCloneAssetGraphSchema.parse(extraction.assetGraph)).not.toThrow()
    expect(extraction.pageIr.purpose).toBe("web-clone-structure-ir")
    expect(extraction.assetGraph.purpose).toBe("web-clone-asset-graph")
    expect(extraction.pageIr.stats.elements).toBeGreaterThanOrEqual(7)
    expect(extraction.pageIr.stats.attributes).toBeGreaterThanOrEqual(6)

    const kinds = extraction.assetGraph.assets.map((asset) => asset.kind)
    expect(kinds).toContain("css")
    expect(kinds).toContain("svg-path-data")
    expect(kinds).toContain("image-data-uri")

    const serializedIr = JSON.stringify(extraction.pageIr)
    expect(serializedIr).toContain("page")
    expect(serializedIr).toContain("shell")
    expect(serializedIr).toContain("https://example.test/report")
    expect(serializedIr).toContain("__WEB_CLONE_ASSET_REF_")
    expect(serializedIr).not.toContain(longPath)
    expect(serializedIr).not.toContain("UE5HREFUQQ==")

    const pathAsset = extraction.assetGraph.assets.find((asset) => asset.kind === "svg-path-data")
    expect(pathAsset?.semanticRole).toBe("svg-geometry")
    expect(pathAsset?.usedBy[0]?.tag).toBe("path")
    expect(pathAsset?.usedBy[0]?.attribute).toBe("d")
    expect(pathAsset && extraction.assetContents[pathAsset.id]).toBe(longPath)
  })

  test("writes prompt IR and sidecar resources to deterministic locations", async () => {
    await using tmp = await tmpdir()
    const html = `<html><head><style>${".a{color:red}".repeat(60)}</style></head><body><p>Hello</p></body></html>`
    const extraction = extractArchiveHtml({ html, title: "Write Test" })
    await writeWebCloneArchiveExtraction(path.join(tmp.path, "web-clone"), extraction)

    const pageIrPath = path.join(tmp.path, "web-clone", "page.ir.json")
    const manifestPath = path.join(tmp.path, "web-clone", "assets", "manifest.json")
    const manifest = JSON.parse(await Bun.file(manifestPath).text())
    const cssAsset = manifest.assets.find((asset: { kind: string }) => asset.kind === "css")

    expect(await Bun.file(pageIrPath).exists()).toBe(true)
    expect(await Bun.file(manifestPath).exists()).toBe(true)
    expect(cssAsset.path).toMatch(/^assets\/styles\/asset_\d+\.css$/)
    expect(await Bun.file(path.join(tmp.path, "web-clone", cssAsset.path)).exists()).toBe(true)
  })
})
