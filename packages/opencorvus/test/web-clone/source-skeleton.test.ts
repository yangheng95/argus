import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"
import {
  auditWebCloneSourceSkeleton,
  buildWebCloneHandoff,
  extractArchiveHtml,
  inspectWebCloneSourceSkeletonEvidence,
  mergeExtractedLayoutIntoPageIr,
  WebCloneSourceSkeletonManifestSchema,
  writeWebCloneArchiveExtraction,
  writeWebCloneSourceSkeleton,
} from "../../src/web-clone"

describe("web-clone source skeleton", () => {
  test("writes source-only HTML/CSS skeleton with screenshot reference and source ids", async () => {
    await using tmp = await tmpdir()
    const sourcePackageDir = path.join(tmp.path, "web-clone-source")
    const extraction = extractArchiveHtml({
      html: `<!doctype html><html><head>
        <title>Calendar</title>
        <style>
          body { margin: 0; font-family: Arial, sans-serif; color: #111827; }
          .calendar { display: grid; grid-template-columns: 180px 1fr; gap: 16px; }
          .event-row { border-top: 1px solid #d1d5db; }
        </style>
      </head><body>
        <main class="calendar">
          <nav><a href="/markets">Markets</a></nav>
          <section>
            <h1>Economic calendar</h1>
            <table>
              <thead><tr><th>Time</th><th>Country</th><th>Actual</th></tr></thead>
              <tbody><tr class="event-row"><td>08:30</td><td>US</td><td>2.1%</td></tr></tbody>
            </table>
          </section>
        </main>
      </body></html>`,
      title: "Calendar",
      url: "https://example.test/calendar",
    })
    extraction.pageIr = mergeExtractedLayoutIntoPageIr(extraction.pageIr, {
      tree: [
        {
          selector: "main.calendar",
          tag: "main",
          bounds: { x: 0, y: 0, w: 960, h: 600 },
          styles: { display: "grid", gridTemplateColumns: "180px 1fr", gap: "16px" },
          text: "Economic calendar 08:30 US 2.1%",
        },
      ],
    })
    await writeWebCloneArchiveExtraction(sourcePackageDir, extraction)
    const handoff = buildWebCloneHandoff(extraction.pageIr, extraction.assetGraph)
    const result = await writeWebCloneSourceSkeleton({
      outputDir: sourcePackageDir,
      pageIr: extraction.pageIr,
      assetGraph: extraction.assetGraph,
      segments: handoff.segments,
    })

    expect(() => WebCloneSourceSkeletonManifestSchema.parse(result.manifest)).not.toThrow()
    expect(result.files).toContain("index.html")
    expect(result.files).toContain("styles.css")
    expect(result.files).toContain("critical.css")
    expect(result.files).toContain("full-source.css")
    expect(result.files).toContain("used-selectors.json")
    expect(result.files).toContain("README.md")
    expect(result.files).toContain("skeleton-manifest.json")
    expect(result.files).toContain("source-ir/component-tree.json")
    expect(result.files).toContain("source-ir/content-model.json")
    expect(result.files).toContain("source-ir/layout-map.json")
    expect(result.files).toContain("source-ir/style-tokens.json")
    expect(result.files).toContain("source-ir/style-profile.json")
    expect(result.files).toContain("source-ir/interaction-hints.json")
    expect(result.files).toContain("source-ir/source-quality-audit.json")
    expect(result.audit.passed).toBe(true)

    const html = await Bun.file(path.join(result.skeletonDir, "index.html")).text()
    const css = await Bun.file(path.join(result.skeletonDir, "styles.css")).text()
    const criticalCss = await Bun.file(path.join(result.skeletonDir, "critical.css")).text()
    const fullSourceCss = await Bun.file(path.join(result.skeletonDir, "full-source.css")).text()
    const usedSelectors = JSON.parse(await Bun.file(path.join(result.skeletonDir, "used-selectors.json")).text())
    const readme = await Bun.file(path.join(result.skeletonDir, "README.md")).text()
    const componentTree = JSON.parse(
      await Bun.file(path.join(sourcePackageDir, "source-ir", "component-tree.json")).text(),
    )
    const contentModel = JSON.parse(
      await Bun.file(path.join(sourcePackageDir, "source-ir", "content-model.json")).text(),
    )
    const sourceQualityAudit = JSON.parse(
      await Bun.file(path.join(sourcePackageDir, "source-ir", "source-quality-audit.json")).text(),
    )
    const styleProfile = JSON.parse(
      await Bun.file(path.join(sourcePackageDir, "source-ir", "style-profile.json")).text(),
    )

    expect(html).toContain('data-reference-image="../reference.png"')
    expect(html).toContain("data-source-node-id=")
    expect(html).toContain("data-source-segment-id=")
    expect(html).toContain("Economic calendar")
    expect(html).toContain("<table")
    expect(css).toContain("@import url('./critical.css')")
    expect(criticalCss).toContain(".calendar")
    expect(criticalCss).toContain("grid-template-columns: 180px 1fr")
    expect(criticalCss).toContain("[data-source-node-id=")
    expect(fullSourceCss).toContain(".event-row")
    expect(usedSelectors.stats.reachableRules).toBeGreaterThan(0)
    expect(componentTree.components.length).toBeGreaterThan(0)
    expect(contentModel.tables.length).toBe(1)
    expect(styleProfile.purpose).toBe("web-clone-style-profile")
    expect(styleProfile.policy.coordinateSpace).toBe("source_capture_viewport_px")
    expect(styleProfile.policy.boundsImplementationUse).toBe("evidence_only")
    expect(styleProfile.regions.length).toBeGreaterThan(0)
    expect(styleProfile.regions[0].styleSummary).toBeDefined()
    expect(styleProfile.regions[0].implementationGuidance.join("\n")).toContain(
      "bounds as source-capture crop/region identity evidence only",
    )
    expect(contentModel.sourceComponentPatterns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "data_grid_surface",
          recommendedReplacementKind: "data_table_or_heatmap_component",
        }),
      ]),
    )
    expect(sourceQualityAudit.passed).toBe(true)
    expect(readme).toContain("This directory is the only development-facing webpage clone seed.")
    expect(readme).toContain("component-tree.json")
    expect(readme).toContain("style-profile.json")
    expect(readme).toContain("critical.css")
    expect(readme).toContain("../assets/manifest.json")
    expect(readme).toContain("data-asset-*")
    expect(readme).toContain("../reference.png")
    expect(readme).not.toContain("bun run dev")

    await Bun.write(path.join(sourcePackageDir, "reference.png"), minimalPngBytes())
    await writeMinimalSourceManifest(sourcePackageDir)
    const evidence = await inspectWebCloneSourceSkeletonEvidence({
      projectDir: tmp.path,
      citedText:
        "Use web-clone-source/source-skeleton/README.md, web-clone-source/source-ir/component-tree.json, web-clone-source/source-skeleton/critical.css, and web-clone-source/source-skeleton/index.html",
    })
    expect(evidence.referenced).toBe(true)
    expect(evidence.ok).toBe(true)
  })

  test("reports class-insensitive repeated component patterns", async () => {
    await using tmp = await tmpdir()
    const sourcePackageDir = path.join(tmp.path, "web-clone-source")
    const extraction = extractArchiveHtml({
      html: `<!doctype html><html><head>
        <title>Products</title>
        <style>
          .catalog { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
          .sku-a-001 { border: 1px solid #ddd; padding: 12px; }
          .sku-b-002 { border: 1px solid #ddd; padding: 12px; }
          .sku-c-003 { border: 1px solid #ddd; padding: 12px; }
        </style>
      </head><body>
        <main>
          <section class="catalog">
            <article class="sku-a-001 selected"><h2>Alpha lamp</h2><p>Ships today</p><a href="/alpha">View</a></article>
            <article class="sku-b-002"><h2>Beta chair</h2><p>Ships tomorrow</p><a href="/beta">View</a></article>
            <article class="sku-c-003"><h2>Gamma desk</h2><p>Ships Friday</p><a href="/gamma">View</a></article>
          </section>
        </main>
      </body></html>`,
      title: "Products",
      url: "https://example.test/products",
    })
    await writeWebCloneArchiveExtraction(sourcePackageDir, extraction)
    const handoff = buildWebCloneHandoff(extraction.pageIr, extraction.assetGraph)
    await writeWebCloneSourceSkeleton({
      outputDir: sourcePackageDir,
      pageIr: extraction.pageIr,
      assetGraph: extraction.assetGraph,
      segments: handoff.segments,
    })

    const contentModel = JSON.parse(
      await Bun.file(path.join(sourcePackageDir, "source-ir", "content-model.json")).text(),
    )

    expect(contentModel.repeatedGroups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          count: 3,
          itemTag: "article",
        }),
      ]),
    )
    expect(contentModel.sourceComponentPatterns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "card_collection_surface",
          recommendedReplacementKind: "card_collection_component",
        }),
      ]),
    )
  })

  test("source skeleton evidence reports a PNG signature without an IHDR chunk", async () => {
    await using tmp = await tmpdir()
    const sourcePackageDir = path.join(tmp.path, "web-clone-source")
    const skeletonDir = path.join(sourcePackageDir, "source-skeleton")
    const sourceIrDir = path.join(sourcePackageDir, "source-ir")
    await Bun.write(path.join(sourcePackageDir, "reference.png"), fakePngWithoutIhdr())
    await Bun.write(
      path.join(skeletonDir, "index.html"),
      '<body data-reference-image="../reference.png"><main>Economic calendar</main></body>',
    )
    await Bun.write(path.join(skeletonDir, "styles.css"), "@import url('./critical.css');")
    await Bun.write(path.join(skeletonDir, "critical.css"), "main { display: block; }")
    await Bun.write(path.join(skeletonDir, "full-source.css"), "main { display: block; }")
    await Bun.write(path.join(skeletonDir, "used-selectors.json"), JSON.stringify({ rules: [] }))
    await Bun.write(path.join(skeletonDir, "README.md"), "../reference.png")
    await Bun.write(
      path.join(skeletonDir, "source-skeleton-audit.json"),
      JSON.stringify({
        version: 1,
        purpose: "web-clone-source-skeleton-audit",
        passed: true,
        hasHtml: true,
        hasCss: true,
        hasCriticalCss: true,
        hasFullSourceCss: true,
        hasUsedSelectors: true,
        hasReadme: true,
        hasSourceIr: true,
        frameworkAgnostic: true,
        referencesScreenshot: true,
        cssAssetBytes: 24,
        criticalCssBytes: 24,
        computedStyleRuleCount: 0,
        replayFactoryDetected: false,
        generatedProjectDetected: false,
        findings: [],
      }),
    )
    for (const file of [
      "component-tree.json",
      "content-model.json",
      "layout-map.json",
      "style-tokens.json",
      "style-profile.json",
      "interaction-hints.json",
    ]) {
      await Bun.write(path.join(sourceIrDir, file), JSON.stringify({ version: 1 }))
    }
    await Bun.write(path.join(sourceIrDir, "source-quality-audit.json"), JSON.stringify({ passed: true }))

    const evidence = await inspectWebCloneSourceSkeletonEvidence({
      projectDir: tmp.path,
      citedText: "Use source-skeleton",
    })

    expect(evidence.referenced).toBe(true)
    expect(evidence.ok).toBe(false)
    expect(evidence.findings.join("\n")).toContain("IHDR")
  })

  test("keeps data URL background declarations intact in critical CSS", async () => {
    await using tmp = await tmpdir()
    const sourcePackageDir = path.join(tmp.path, "web-clone-source")
    const extraction = extractArchiveHtml({
      html: `<!doctype html><html><head>
        <title>BBC style fixture</title>
        <style>
          .hero {
            background-image: image-set(url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB) 1x type("image/png"));
            color: #181818;
          }
        </style>
      </head><body>
        <main class="hero">Welcome to the BBC</main>
      </body></html>`,
      title: "BBC style fixture",
      url: "https://example.test/bbc",
    })
    extraction.pageIr = mergeExtractedLayoutIntoPageIr(extraction.pageIr, {
      tree: [
        {
          selector: "main.hero",
          tag: "main",
          bounds: { x: 0, y: 0, w: 1440, h: 900 },
          styles: {
            backgroundImage:
              'image-set(url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB) 1x type("image/png"))',
            color: "rgb(24, 24, 24)",
          },
          text: "Welcome to the BBC",
        },
      ],
    })
    await writeWebCloneArchiveExtraction(sourcePackageDir, extraction)
    const handoff = buildWebCloneHandoff(extraction.pageIr, extraction.assetGraph)
    const result = await writeWebCloneSourceSkeleton({
      outputDir: sourcePackageDir,
      pageIr: extraction.pageIr,
      assetGraph: extraction.assetGraph,
      segments: handoff.segments,
    })

    const criticalCss = await Bun.file(path.join(result.skeletonDir, "critical.css")).text()

    expect(result.audit.passed).toBe(true)
    expect(criticalCss).toContain("data:image/png;base64")
    expect(criticalCss).toContain('type("image/png")')
    expect(criticalCss).toContain("color: #181818")
    expect(criticalCss).not.toContain("background-image: image-set(url(data:image/png; color")
  })

  test("audit rejects runtime replay and generated-project markers", async () => {
    await using tmp = await tmpdir()
    const skeletonDir = path.join(tmp.path, "source-skeleton")
    await Bun.write(
      path.join(skeletonDir, "index.html"),
      '<body data-reference-image="../reference.png"><script>document.createElement("div")</script></body>',
    )
    await Bun.write(path.join(skeletonDir, "styles.css"), ".x { color: red; }")
    await Bun.write(path.join(skeletonDir, "README.md"), "../reference.png\nbun run dev")

    const audit = await auditWebCloneSourceSkeleton(skeletonDir)

    expect(audit.passed).toBe(false)
    expect(audit.replayFactoryDetected).toBe(true)
    expect(audit.generatedProjectDetected).toBe(true)
  })

  test("does not leak extracted style or script placeholder text into visible skeleton HTML", async () => {
    await using tmp = await tmpdir()
    const webpageEvidenceDir = path.join(tmp.path, "webpage-evidence")
    const extraction = extractArchiveHtml({
      html: `<!doctype html><html><head>
        <style>.__WEB_CLONE_CSS_ASSET_0__ { color: red; }</style>
        <script>window.__WEB_CLONE_SCRIPT_ASSET_0__ = true</script>
      </head><body>
        <main><h1>Economic calendar</h1></main>
      </body></html>`,
      title: "Calendar",
      url: "https://example.test/calendar",
    })
    await writeWebCloneArchiveExtraction(webpageEvidenceDir, extraction)
    const handoff = buildWebCloneHandoff(extraction.pageIr, extraction.assetGraph)
    const result = await writeWebCloneSourceSkeleton({
      outputDir: webpageEvidenceDir,
      pageIr: extraction.pageIr,
      assetGraph: extraction.assetGraph,
      segments: handoff.segments,
    })

    const html = await Bun.file(path.join(result.skeletonDir, "index.html")).text()

    expect(html).toContain("Economic calendar")
    expect(html).not.toContain("__WEB_CLONE_CSS_ASSET_0__")
    expect(html).not.toContain("__WEB_CLONE_SCRIPT_ASSET_0__")
    expect(result.audit.placeholderTextDetected).toBe(false)
    expect(result.audit.passed).toBe(true)
  })

  test("omits hidden single-file duplicate nodes from visible skeleton HTML", async () => {
    await using tmp = await tmpdir()
    const webpageEvidenceDir = path.join(tmp.path, "webpage-evidence")
    const extraction = extractArchiveHtml({
      html: `<!doctype html><html><head>
        <style>.visible { display: block; }</style>
      </head><body>
        <main>
          <section class="visible"><h1>Markets today</h1></section>
          <section class="sf-hidden" aria-hidden="true"><h1>Hidden responsive duplicate</h1></section>
        </main>
      </body></html>`,
      title: "Markets",
      url: "https://example.test/markets",
    })
    await writeWebCloneArchiveExtraction(webpageEvidenceDir, extraction)
    const handoff = buildWebCloneHandoff(extraction.pageIr, extraction.assetGraph)
    const result = await writeWebCloneSourceSkeleton({
      outputDir: webpageEvidenceDir,
      pageIr: extraction.pageIr,
      assetGraph: extraction.assetGraph,
      segments: handoff.segments,
    })

    const html = await Bun.file(path.join(result.skeletonDir, "index.html")).text()

    expect(html).toContain("Markets today")
    expect(html).not.toContain("Hidden responsive duplicate")
    expect(html).not.toContain("sf-hidden")
    expect(html).not.toContain('aria-hidden="true"')
    expect(result.audit.hiddenSourceNodeDetected).toBe(false)
    expect(result.audit.passed).toBe(true)
  })

  test("preserves SVG geometry sidecar references for downstream framework code", async () => {
    await using tmp = await tmpdir()
    const webpageEvidenceDir = path.join(tmp.path, "webpage-evidence")
    const extraction = extractArchiveHtml({
      html: `<!doctype html><html><body>
        <main>
          <svg viewBox="0 0 10 10" width="10" height="10" aria-label="trend map">
            <path class="country positive" fill="#2962ff" d="M0 0 L10 0 L10 10 L0 10 Z"></path>
          </svg>
        </main>
      </body></html>`,
      title: "Map",
      url: "https://example.test/map",
    })
    await writeWebCloneArchiveExtraction(webpageEvidenceDir, extraction)
    const handoff = buildWebCloneHandoff(extraction.pageIr, extraction.assetGraph)
    const result = await writeWebCloneSourceSkeleton({
      outputDir: webpageEvidenceDir,
      pageIr: extraction.pageIr,
      assetGraph: extraction.assetGraph,
      segments: handoff.segments,
    })

    const html = await Bun.file(path.join(result.skeletonDir, "index.html")).text()

    expect(html).toContain("<svg")
    expect(html).toContain('viewBox="0 0 10 10"')
    expect(html).toContain('width="10"')
    expect(html).toContain('height="10"')
    expect(html).toContain('fill="#2962ff"')
    expect(html).toContain('data-asset-d="../assets/svg/')
    expect(html).not.toContain('d="M0 0 L10 0 L10 10 L0 10 Z"')
    expect(result.audit.passed).toBe(true)
  })

  test("audit rejects placeholder and hidden-node leakage in source skeleton HTML", async () => {
    await using tmp = await tmpdir()
    const skeletonDir = path.join(tmp.path, "source-skeleton")
    await Bun.write(
      path.join(skeletonDir, "index.html"),
      '<body data-reference-image="../reference.png"><main class="sf-hidden">__WEB_CLONE_CSS_ASSET_0__</main></body>',
    )
    await Bun.write(path.join(skeletonDir, "styles.css"), "@import url('./critical.css')")
    await Bun.write(path.join(skeletonDir, "critical.css"), ".x { color: red; }")
    await Bun.write(path.join(skeletonDir, "full-source.css"), ".x { color: red; }")
    await Bun.write(path.join(skeletonDir, "used-selectors.json"), "{}")
    await Bun.write(path.join(skeletonDir, "README.md"), "../reference.png")

    const audit = await auditWebCloneSourceSkeleton(skeletonDir)

    expect(audit.passed).toBe(false)
    expect(audit.placeholderTextDetected).toBe(true)
    expect(audit.hiddenSourceNodeDetected).toBe(true)
    expect(audit.findings).toContain("source skeleton leaks extracted asset placeholder text into visible HTML")
    expect(audit.findings).toContain("source skeleton includes hidden source-only duplicate nodes in visible HTML")
  })
})

function minimalPngBytes(): Uint8Array {
  return Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49,
    0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00,
    0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ])
}

function fakePngWithoutIhdr(): Uint8Array {
  const bytes = new Uint8Array(32)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  bytes.set([0x00, 0x00, 0x00, 0x0d], 8)
  bytes.set([0x49, 0x44, 0x41, 0x54], 12)
  bytes.set([0x00, 0x00, 0x00, 0x01], 16)
  bytes.set([0x00, 0x00, 0x00, 0x01], 20)
  return bytes
}

async function writeMinimalSourceManifest(sourcePackageDir: string): Promise<void> {
  const referenceSha256 = createHash("sha256").update(Buffer.from(minimalPngBytes())).digest("hex")
  await Bun.write(
    path.join(sourcePackageDir, "web-clone-source-manifest.json"),
    JSON.stringify(
      {
        version: 1,
        purpose: "web-clone-visible-source-package",
        provenance: {
          source: "webpage-evidence",
          webpageEvidenceDir: sourcePackageDir,
          reference: {
            path: "reference.png",
            sha256: referenceSha256,
            width: 1,
            height: 1,
            bytes: minimalPngBytes().length,
          },
        },
        files: [
          {
            path: "reference.png",
            sha256: referenceSha256,
            bytes: minimalPngBytes().length,
            source: "webpage-evidence/reference.png",
          },
        ],
      },
      null,
      2,
    ),
  )
}
