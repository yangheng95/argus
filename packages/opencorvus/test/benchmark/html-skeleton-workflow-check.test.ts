import { describe, expect, test } from "bun:test"
import path from "node:path"
import { runHtmlSkeletonWorkflowCheck } from "../../script/benchmark/html-skeleton-workflow-check"
import { tmpdir } from "../fixture/fixture"

describe("html skeleton workflow check", () => {
  test("accepts a task-scoped visual HTML skeleton artifact set", async () => {
    await using tmp = await tmpdir()
    const frontendDesignDir = path.join(tmp.path, "frontend-design")
    const visualRoot = path.join(frontendDesignDir, "visual-html-skeleton")
    const sourcePackageDir = path.join(frontendDesignDir, "web-clone-source")
    await writeSourceEvidence(sourcePackageDir)
    await Bun.write(path.join(visualRoot, "index.html"), [
      "<!doctype html>",
      "<html>",
      "<head><link rel=\"stylesheet\" href=\"./styles/tokens.css\"><link rel=\"stylesheet\" href=\"./styles.css\"></head>",
      "<body>",
      "<main>",
      "<h1>Economy Overview</h1>",
      "<section>Economic trends, countries, ideas, news, calendar, and frequently asked questions.</section>",
      "<table><tr><th>GDP</th><td>29.18T USD</td></tr></table>",
      "</main>",
      "</body>",
      "</html>",
    ].join(""))
    await Bun.write(path.join(visualRoot, "styles", "tokens.css"), ":root{--color-canvas:#fff;--text-primary:#131722;--space-4:16px}")
    await Bun.write(path.join(visualRoot, "styles.css"), "body{font-family:Arial,sans-serif}.page{max-width:1200px;margin:auto}")
    await Bun.write(path.join(frontendDesignDir, "frontend-template.md"), [
      "## Frontend Project",
      "- role: visual_baseline_input",
      "- project_root: visual-html-skeleton",
      "- entrypoints:",
      "  - visual-html-skeleton/index.html",
      "- evidence: visual-diff rendered screenshot",
      "submit_frontend_template",
    ].join("\n"))
    await Bun.write(path.join(frontendDesignDir, "evidence-source-manifest.md"), "web-clone-source/reference.png")
    await Bun.write(path.join(frontendDesignDir, "frontend-design-process-trace.json"), JSON.stringify({
      events: [
        { name: "create_frontend_skeleton_project" },
        { name: "record_frontend_region_selection" },
        { name: "record_frontend_replacement_result" },
        { name: "submit_frontend_template" },
      ],
    }))
    await Bun.write(path.join(frontendDesignDir, "frontend-design-iteration-state.json"), JSON.stringify({
      completed: ["hero"],
      blocked: [],
      deferred: [],
      remainingSourceDebt: [],
    }))
    await Bun.write(path.join(frontendDesignDir, "workflow.log"), "create_frontend_skeleton_project\nsubmit_frontend_template\n")

    const report = await runHtmlSkeletonWorkflowCheck({
      frontendDesignDir,
      outDir: path.join(tmp.path, "out"),
      threshold: 0.95,
      worstThreshold: 0.8,
      headless: true,
      artifactsOnly: true,
    })

    expect(report.passed).toBe(true)
    expect(report.checks.every((check) => check.passed)).toBe(true)
    expect(await Bun.file(path.join(tmp.path, "out", "html-skeleton-workflow-report.json")).exists()).toBe(true)
  })

  test("rejects captured source evidence and screenshot-only HTML as the visual skeleton", async () => {
    await using tmp = await tmpdir()
    const frontendDesignDir = path.join(tmp.path, "frontend-design")
    const sourcePackageDir = path.join(frontendDesignDir, "web-clone-source")
    await writeSourceEvidence(sourcePackageDir)
    await Bun.write(path.join(sourcePackageDir, "source-skeleton", "index.html"), [
      "<!doctype html>",
      "<html><body><img src=\"reference.png\"><span> </span></body></html>",
    ].join(""))
    await Bun.write(path.join(frontendDesignDir, "frontend-template.md"), "- role: visual_baseline_input\nvisual-html-skeleton/index.html\nvisual-diff\n")

    const report = await runHtmlSkeletonWorkflowCheck({
      frontendDesignDir,
      visualRoot: path.join(sourcePackageDir, "source-skeleton"),
      outDir: path.join(tmp.path, "out"),
      threshold: 0.95,
      worstThreshold: 0.8,
      headless: true,
      artifactsOnly: true,
    })

    expect(report.passed).toBe(false)
    expect(report.checks.find((check) => check.id === "visual-root-is-design-output")?.passed).toBe(false)
    expect(report.checks.find((check) => check.id === "not-reference-image-only")?.passed).toBe(false)
  })
})

async function writeSourceEvidence(sourcePackageDir: string): Promise<void> {
  await Bun.write(path.join(sourcePackageDir, "reference.png"), minimalPngBytes())
  await Bun.write(path.join(sourcePackageDir, "README.md"), "web clone source")
  await Bun.write(path.join(sourcePackageDir, "implementation-blueprint.md"), "Build source-derived visual skeleton.")
  await Bun.write(path.join(sourcePackageDir, "web-clone-implementation-contract.json"), "{}")
  await Bun.write(path.join(sourcePackageDir, "source-ir", "component-tree.json"), "{}")
  await Bun.write(path.join(sourcePackageDir, "source-ir", "content-model.json"), "{}")
  await Bun.write(path.join(sourcePackageDir, "source-ir", "layout-map.json"), "{}")
  await Bun.write(path.join(sourcePackageDir, "source-ir", "style-profile.json"), "{}")
  await Bun.write(path.join(sourcePackageDir, "source-ir", "style-tokens.json"), "{}")
  await Bun.write(path.join(sourcePackageDir, "source-ir", "interaction-hints.json"), "{}")
  await Bun.write(path.join(sourcePackageDir, "source-skeleton", "index.html"), "<main>source</main>")
  await Bun.write(path.join(sourcePackageDir, "source-skeleton", "critical.css"), "body{font-family:Arial,sans-serif}")
  await Bun.write(path.join(sourcePackageDir, "source-skeleton", "source-skeleton-audit.json"), "{\"passed\":true}")
}

function minimalPngBytes(): Uint8Array {
  return Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
    0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
    0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
    0x42, 0x60, 0x82,
  ])
}
