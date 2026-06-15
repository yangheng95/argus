import { describe, expect, test } from "bun:test"
import path from "node:path"
import { generateWebCloneSkeletonProject } from "../../src/web-clone/skeleton-project-generator"
import { tmpdir } from "../fixture/fixture"

describe("web-clone skeleton project generator", () => {
  test("hydrates source-skeleton assets into a runnable skeleton project", async () => {
    await using tmp = await tmpdir()
    const sourcePackageDir = await writeFixtureSourcePackage(tmp.path)
    const outputDir = path.join(tmp.path, "frontend-design-skeleton")

    const result = await generateWebCloneSkeletonProject({
      sourcePackageDir,
      outputDir,
    })

    expect(result.stats.sourceHtml).toBe("source-skeleton")
    expect(result.stats.hydratedSvgPaths).toBe(1)
    expect(result.stats.slotCount).toBeGreaterThan(0)
    expect(await Bun.file(path.join(outputDir, "index.html")).exists()).toBe(true)
    expect(await Bun.file(path.join(outputDir, "public", "source.html")).exists()).toBe(true)
    expect(await Bun.file(path.join(outputDir, "src", "App.jsx")).exists()).toBe(true)
    expect(await Bun.file(path.join(outputDir, "src", "generated", "singlefile-body.html")).exists()).toBe(true)
    expect(await Bun.file(path.join(outputDir, "src", "generated", "singlefile-head-styles.html")).exists()).toBe(true)
    expect(await Bun.file(path.join(outputDir, "src", "skeleton.css")).exists()).toBe(true)
    expect(await Bun.file(path.join(outputDir, "src", "slots.json")).exists()).toBe(true)
    expect(await Bun.file(path.join(outputDir, "reference.png")).exists()).toBe(true)
    expect(await Bun.file(path.join(outputDir, "reference-mobile.png")).exists()).toBe(true)

    const html = await Bun.file(path.join(outputDir, "public", "source.html")).text()
    expect(html).toContain('data-asset-d="../assets/svg/asset_000001.path.txt"')
    expect(html).toContain('d="M0 0H10V10Z"')
    expect(html).toContain('href="./assets/asset_000002.svg"')

    const app = await Bun.file(path.join(outputDir, "src", "App.jsx")).text()
    expect(app).not.toContain("<iframe")
    expect(app).toContain("singlefile-body.html?raw")
    expect(app).toContain("singlefile-head-styles.html?raw")

    const body = await Bun.file(path.join(outputDir, "src", "generated", "singlefile-body.html")).text()
    expect(body).toContain("Economy")
    expect(body).toContain('d="M0 0H10V10Z"')

    const css = await Bun.file(path.join(outputDir, "src", "skeleton.css")).text()
    expect(css).toContain("source-skeleton/critical.css")
    expect(css).toContain(".economy")

    const packageJson = await Bun.file(path.join(outputDir, "package.json")).json()
    expect(packageJson.packageManager).toBe("npm@10.9.0")
    expect(packageJson.scripts.build).toContain("extract-source-html")
    expect(packageJson.scripts.dev).toContain("vite --host 127.0.0.1")
    expect(packageJson.scripts.preview).toBe("vite preview --host 127.0.0.1 --strictPort")
    expect(JSON.stringify(packageJson.scripts)).not.toContain("bunx")
    expect(result.warnings).toContain(
      "No SingleFile HTML was available; the baseline uses source-skeleton HTML and may be less visually complete.",
    )
  })

  test("prefers SingleFile HTML when present", async () => {
    await using tmp = await tmpdir()
    const sourcePackageDir = await writeFixtureSourcePackage(tmp.path)
    await Bun.write(
      path.join(sourcePackageDir, "singlefile.html"),
      "<!doctype html><html><body><main>SingleFile page</main></body></html>",
    )
    const outputDir = path.join(tmp.path, "singlefile-skeleton")

    const result = await generateWebCloneSkeletonProject({
      sourcePackageDir,
      outputDir,
    })

    expect(result.stats.sourceHtml).toBe("singlefile")
    const sourceHtml = await Bun.file(path.join(outputDir, "public", "source.html")).text()
    expect(sourceHtml).toContain("SingleFile page")

    const body = await Bun.file(path.join(outputDir, "src", "generated", "singlefile-body.html")).text()
    expect(body).toContain("SingleFile page")

    const app = await Bun.file(path.join(outputDir, "src", "App.jsx")).text()
    expect(app).not.toContain("iframe")
  })

  test("can generate from an explicit SingleFile HTML without source-skeleton", async () => {
    await using tmp = await tmpdir()
    const sourcePackageDir = path.join(tmp.path, "web-clone-source")
    const singleFilePath = path.join(tmp.path, "capture.html")
    await Bun.write(path.join(sourcePackageDir, "reference.png"), minimalPngBytes())
    await Bun.write(
      singleFilePath,
      '<!doctype html><html><head><style>.page{color:red}</style></head><body><main class="page">Captured</main></body></html>',
    )
    const outputDir = path.join(tmp.path, "explicit-singlefile-skeleton")

    const result = await generateWebCloneSkeletonProject({
      sourcePackageDir,
      outputDir,
      singleFileHtmlPath: singleFilePath,
    })

    expect(result.stats.sourceHtml).toBe("singlefile")
    expect(await Bun.file(path.join(outputDir, "src", "generated", "singlefile-body.html")).text()).toContain(
      "Captured",
    )
    expect(await Bun.file(path.join(outputDir, "src", "generated", "singlefile-head-styles.html")).text()).toContain(
      ".page{color:red}",
    )
  })
})

async function writeFixtureSourcePackage(root: string): Promise<string> {
  const sourcePackageDir = path.join(root, "web-clone-source")
  await Bun.write(path.join(sourcePackageDir, "reference.png"), minimalPngBytes())
  await Bun.write(path.join(sourcePackageDir, "reference-mobile.png"), minimalPngBytes())
  await Bun.write(path.join(sourcePackageDir, "assets", "svg", "asset_000001.path.txt"), "M0 0H10V10Z")
  await Bun.write(path.join(sourcePackageDir, "assets", "asset_000002.svg"), "<svg />")
  await Bun.write(
    path.join(sourcePackageDir, "source-skeleton", "index.html"),
    `
    <main class="economy" data-source-node-id="node_main">
      <h1>Economy</h1>
      <svg viewBox="0 0 10 10"><path data-asset-d="../assets/svg/asset_000001.path.txt"></path></svg>
      <svg><use data-asset-href="../assets/asset_000002.svg"></use></svg>
    </main>
  `,
  )
  await Bun.write(path.join(sourcePackageDir, "source-skeleton", "critical.css"), ".economy { display: grid; }")
  await Bun.write(path.join(sourcePackageDir, "source-skeleton", "full-source.css"), ".economy h1 { font-size: 48px; }")
  await Bun.write(
    path.join(sourcePackageDir, "source-ir", "content-model.json"),
    JSON.stringify(
      {
        components: [{ kind: "hero", title: "Economy", sourceNodeId: "node_main" }],
      },
      null,
      2,
    ),
  )
  return sourcePackageDir
}

function minimalPngBytes(): Uint8Array {
  return Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49,
    0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00,
    0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ])
}
