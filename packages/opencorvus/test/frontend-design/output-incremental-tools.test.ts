import { expect, test } from "bun:test"
import { asSchema } from "ai"
import { readFileSync } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  createFrontendTemplateOutputTools,
  renderVisualHtmlSkeletonScreenshotForValidation,
} from "../../src/frontend-design/output-tools"

function callTool(tools: Record<string, any>, name: string, input: unknown): Promise<string> {
  return tools[name].execute!(input as any, {} as any)
}

const phases = [
  "evidence_lock",
  "implementation_scaffold",
  "data_component_transcription",
  "runtime_visual_verification",
  "source_quality_cleanup",
] as const

async function registerMinimalFrontendResult(kit = createFrontendTemplateOutputTools()) {
  const { tools } = kit
  await callTool(tools, "update_frontend_basics", {
    design_system: "source-backed custom visual system",
    tech_stack: ["React", "Vite", "CSS modules", "local fixture data"],
    final_acceptance_mode: "maintainable_replacement_required",
  })
  await callTool(tools, "update_frontend_item", {
    target: "frontend_template_sections",
    item: {
      title: "Desktop page skeleton",
      detail: "Represent the visible first viewport with source-backed layout, data, and visual anchors.",
      source_refs: ["web-clone-source/reference.png"],
    },
  })
  await callTool(tools, "update_frontend_item", {
    target: "fillable_module_items",
    item: {
      title: "Market overview modules",
      detail: "Group repeated cards, tables, and navigation surfaces into bounded component/data modules.",
      source_refs: ["web-clone-source/source-ir/content-model.json"],
    },
  })
  await callTool(tools, "update_frontend_component_reuse", {
    family_id: "market-card-grid",
    name: "Market card grid",
    observed_surface: "Repeated market overview cards and dense financial rows.",
    source_refs: ["web-clone-source/reference.png"],
    implementation_strategy: "project_specific_component",
    reuse_source: "src/components/MarketCardGrid.tsx",
    mature_library_candidates: [],
    props_states: "cards render from fixture rows with normal and empty visual states",
    replacement_boundary: "overview card/list region",
    parity_guard: "Compare rendered desktop screenshot against web-clone-source/reference.png.",
    project_specific_reason:
      "The visible surface is page-specific and no existing component evidence is available in this isolated test.",
  })
  await callTool(tools, "update_frontend_material", {
    title: "Source visual materials",
    detail: "Use reference pixels, source CSS tokens, and content fixtures required by the page skeleton.",
    source_refs: ["web-clone-source/reference.png", "web-clone-source/source-ir/style-tokens.json"],
  })
  await callTool(tools, "update_frontend_item", {
    target: "visual_consistency_items",
    item: {
      title: "Desktop visual parity",
      detail: "Match hierarchy, density, typography, color roles, and first-viewport region order.",
      source_refs: ["web-clone-source/reference.png"],
    },
  })
  await callTool(tools, "update_frontend_item", {
    target: "ui_data_contract_items",
    item: {
      title: "Local fixture data",
      detail: "Render repeated tables/cards from local source-backed fixture arrays.",
      source_refs: ["web-clone-source/source-ir/content-model.json"],
    },
  })
  for (const phase of phases) {
    await callTool(tools, "update_frontend_phase", {
      id: `phase-${phase}`,
      phase,
      title: phase.replaceAll("_", " "),
      deliverable: `Complete ${phase} for the maintainable replacement handoff.`,
      source_refs: ["web-clone-source/reference.png"],
      acceptance: `The ${phase} outcome is observable and cited before downstream implementation.`,
    })
  }
  await callTool(tools, "update_frontend_iteration_note", {
    value: "Reviewed inventory coverage and maintainable handoff completeness before finalization.",
  })
  await callTool(tools, "update_frontend_iteration_note", {
    value: "Reviewed downstream implementation readiness against the same source-backed evidence.",
  })
  await callTool(tools, "update_frontend_text", {
    section: "completeness_review",
    content: "The frontend result is complete enough for downstream implementation and visual verification.",
  })
  return kit
}

test("submit_frontend_template exposes a small finalizer schema", () => {
  const schema = asSchema(createFrontendTemplateOutputTools().tools.submit_frontend_template.inputSchema)
    .jsonSchema as any

  expect(Object.keys(schema.properties ?? {}).sort()).toEqual(["fact_check_items", "final"])
  expect(schema.properties).not.toHaveProperty("frontend_template")
  expect(schema.properties).not.toHaveProperty("component_reuse_plan")
})

test("static HTML screenshot helper owns navigation by browser inactivity", () => {
  const source = readFileSync(path.join(import.meta.dir, "../../src/frontend-design/output-tools.ts"), "utf8")

  expect(source).toContain("opencorvusWithBrowserInactivity")
  expect(source).toContain('() => page.goto(payload.url, { waitUntil: "domcontentloaded", timeout: 0 })')
  expect(source).toContain('() => page.waitForLoadState("networkidle", { timeout: 0 })')
  expect(source).toContain("browser failure before evidence capture")
  expect(source).toContain("installOpencorvusBrowserFailureTracker")
  expect(source).toContain("opencorvusIsBrowserInactivityError")
  expect(source).toContain('on("requestfailed", (payload) => fail(opencorvusActivityLabel("requestfailed", payload)))')
  expect(source).toContain('on("pageerror", (payload) => fail(opencorvusActivityLabel("pageerror", payload)))')
  expect(source).not.toContain('page.goto(payload.url, { waitUntil: "networkidle", timeout: payload.timeoutMs })')
  expect(source).not.toContain(").catch(() => undefined);")
})

test(
  "static HTML screenshot rejects page errors during optional networkidle stabilization",
  async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-static-html-late-pageerror-"))
    const entrypoint = path.join(tmp, "index.html")
    await fs.writeFile(
      entrypoint,
      `<!doctype html>
        <html>
          <head><title>Late static pageerror</title></head>
          <body>
            <main style="width:320px;height:200px;background:#f8fafc">Static preview</main>
            <script>setTimeout(() => { throw new Error("late static pageerror") }, 100)</script>
          </body>
        </html>`,
      "utf8",
    )

    await expect(
      renderVisualHtmlSkeletonScreenshotForValidation({
        entrypointFile: entrypoint,
        viewport: { width: 320, height: 200 },
        timeoutMs: 10_000,
      }),
    ).rejects.toThrow("late static pageerror")
  },
  30_000,
)

test("submit_frontend_template reports missing update calls without closing the collector", async () => {
  const kit = createFrontendTemplateOutputTools()
  await callTool(kit.tools, "update_frontend_basics", {
    design_system: "source-backed custom visual system",
    tech_stack: ["React"],
    final_acceptance_mode: "maintainable_replacement_required",
  })

  const result = await callTool(kit.tools, "submit_frontend_template", { final: true })
  const status = await callTool(kit.tools, "inspect_frontend_result_status", {})

  expect(result).toContain("MISSING_FRONTEND_TEMPLATE_RESULT")
  expect(result).toContain("update_frontend_component_reuse")
  expect(result).toContain("update_frontend_phase")
  expect(status).toContain("FRONTEND_TEMPLATE_RESULT_STATUS: incomplete")
  expect(kit.getCollector().final).toBeUndefined()
})

test("update_frontend_visual_evidence rejects source references outside web-clone-source", async () => {
  const kit = createFrontendTemplateOutputTools()

  await expect(
    callTool(kit.tools, "update_frontend_visual_evidence", {
      id: "desktop",
      render_target: "visual-html-skeleton",
      rendered_entrypoint: "visual-html-skeleton/index.html",
      screenshot_artifact: "visual-html-skeleton/screenshots/desktop.png",
      source_reference_artifact: "webpage-evidence/reference.png",
      renderer: "node_playwright_static_file",
      viewport: "desktop-320x180",
      screenshot_sha256: "a".repeat(64),
      source_reference_sha256: "b".repeat(64),
      diff_artifact: "visual-html-skeleton/visual-diff.json",
      review_status: "reviewed_no_blocking_debt",
      review_summary: "Rendered screenshot was reviewed against the source reference.",
    }),
  ).rejects.toThrow("source_reference_artifact")
})

test("update_frontend reference and source refs reject rendered local preview captures", async () => {
  const kit = createFrontendTemplateOutputTools()
  const localPreview = "/tmp/opencorvus-capture/1782540923070-jbqnrq/screenshot.png"
  const durablePreview = "visual-html-skeleton/screenshots/desktop.png"
  const durableDiff = "visual-html-skeleton/visual-diffs/desktop.json"
  const localhostPreview = "http://127.0.0.1:4177/index.html"
  const bareLocalhostPreview = "http://localhost"
  const schemelessLocalhostPreview = "localhost:4177/index.html"

  await expect(callTool(kit.tools, "update_frontend_reference", { value: localPreview })).rejects.toThrow(
    "source/reference artifacts",
  )
  await expect(callTool(kit.tools, "update_frontend_reference", { value: durablePreview })).rejects.toThrow(
    "source/reference artifacts",
  )
  await expect(callTool(kit.tools, "update_frontend_reference", { value: durableDiff })).rejects.toThrow(
    "source/reference artifacts",
  )
  await expect(callTool(kit.tools, "update_frontend_reference", { value: bareLocalhostPreview })).rejects.toThrow(
    "source/reference artifacts",
  )

  await expect(
    callTool(kit.tools, "update_frontend_material", {
      title: "Rendered skeleton preview",
      detail: "Rendered skeleton previews belong in visual validation evidence, not material source refs.",
      source_refs: [localPreview],
    }),
  ).rejects.toThrow("source/reference artifacts")

  await expect(
    callTool(kit.tools, "update_frontend_material", {
      title: "Rendered skeleton preview",
      detail: "Task-scoped rendered previews and diffs belong in visual validation evidence, not material source refs.",
      source_refs: [durablePreview, durableDiff],
    }),
  ).rejects.toThrow("source/reference artifacts")

  await expect(
    callTool(kit.tools, "update_frontend_material", {
      title: "Local preview URL",
      detail: "Local preview URLs are rendered output, not source refs.",
      source_refs: [localhostPreview],
    }),
  ).rejects.toThrow("source/reference artifacts")

  await expect(
    callTool(kit.tools, "update_frontend_material", {
      title: "Bare local preview URL",
      detail: "Bare localhost URLs are rendered output, not source refs.",
      source_refs: [bareLocalhostPreview],
    }),
  ).rejects.toThrow("source/reference artifacts")

  await expect(
    callTool(kit.tools, "update_frontend_material", {
      title: "Schemeless local preview URL",
      detail: "Schemeless localhost URLs are rendered output, not source refs.",
      source_refs: [schemelessLocalhostPreview],
    }),
  ).rejects.toThrow("source/reference artifacts")

  await expect(
    callTool(kit.tools, "update_frontend_project", {
      status: "created",
      role: "visual_baseline_input",
      project_root: "visual-html-skeleton",
      source_package: "web-clone-source",
      entrypoints: [localPreview],
      generation_tool: "source-ir-static-html-skeleton",
      notes: ["visual baseline"],
    }),
  ).rejects.toThrow("frontend_project.entrypoints")

  await expect(
    callTool(kit.tools, "update_frontend_project", {
      status: "created",
      role: "visual_baseline_input",
      project_root: "visual-html-skeleton",
      source_package: "web-clone-source",
      entrypoints: [schemelessLocalhostPreview],
      generation_tool: "source-ir-static-html-skeleton",
      notes: ["visual baseline"],
    }),
  ).rejects.toThrow("frontend_project.entrypoints")

  await expect(
    callTool(kit.tools, "update_frontend_project", {
      status: "created",
      role: "visual_baseline_input",
      project_root: "visual-html-skeleton",
      source_package: "web-clone-source",
      entrypoints: [localhostPreview],
      generation_tool: "source-ir-static-html-skeleton",
      notes: ["visual baseline"],
    }),
  ).rejects.toThrow("frontend_project.entrypoints")

  await expect(
    callTool(kit.tools, "update_frontend_project", {
      status: "created",
      role: "visual_baseline_input",
      project_root: "visual-html-skeleton",
      source_package: "web-clone-source",
      entrypoints: [bareLocalhostPreview],
      generation_tool: "source-ir-static-html-skeleton",
      notes: ["visual baseline"],
    }),
  ).rejects.toThrow("frontend_project.entrypoints")

  await expect(
    callTool(kit.tools, "update_frontend_visual_evidence", {
      id: "desktop",
      render_target: "visual-html-skeleton",
      rendered_entrypoint: "visual-html-skeleton/index.html",
      screenshot_artifact: "screenshots/desktop.png",
      source_reference_artifact: "web-clone-source/reference.png",
      renderer: "task_scoped_backend_browser",
      viewport: "1440x900",
      screenshot_sha256: "a".repeat(64),
      source_reference_sha256: "b".repeat(64),
      diff_artifact: "",
      review_status: "reviewed_with_blocking_debt",
      review_summary: "Rendered skeleton preview was compared against the source reference.",
    }),
  ).rejects.toThrow("screenshot_artifact")

  await expect(
    callTool(kit.tools, "update_frontend_visual_evidence", {
      id: "desktop",
      render_target: "visual-html-skeleton",
      rendered_entrypoint: "visual-html-skeleton/index.html",
      screenshot_artifact: durablePreview,
      source_reference_artifact: "web-clone-source/reference.png",
      renderer: "task_scoped_backend_browser",
      viewport: "1440x900",
      screenshot_sha256: "a".repeat(64),
      source_reference_sha256: "b".repeat(64),
      diff_artifact: "diffs/desktop.json",
      review_status: "reviewed_with_blocking_debt",
      review_summary: "Rendered skeleton preview was compared against the source reference.",
    }),
  ).rejects.toThrow("diff_artifact")

  await expect(
    callTool(kit.tools, "update_frontend_visual_evidence", {
      id: "desktop",
      render_target: "visual-html-skeleton",
      rendered_entrypoint: "visual-html-skeleton/index.html",
      screenshot_artifact: localPreview,
      source_reference_artifact: "web-clone-source/reference.png",
      renderer: "task_scoped_backend_browser",
      viewport: "1440x900",
      screenshot_sha256: "a".repeat(64),
      source_reference_sha256: "b".repeat(64),
      diff_artifact: "/tmp/opencorvus-capture/1782540923070-jbqnrq/manifest.json",
      review_status: "reviewed_with_blocking_debt",
      review_summary: "Rendered skeleton preview was compared against the source reference.",
    }),
  ).rejects.toThrow("screenshot_artifact")

  await expect(
    callTool(kit.tools, "update_frontend_visual_evidence", {
      id: "desktop",
      render_target: "visual-html-skeleton",
      rendered_entrypoint: "visual-html-skeleton/index.html",
      screenshot_artifact: durablePreview,
      source_reference_artifact: "web-clone-source/reference.png",
      renderer: "task_scoped_backend_browser",
      viewport: "1440x900",
      screenshot_sha256: "a".repeat(64),
      source_reference_sha256: "b".repeat(64),
      diff_artifact: "/tmp/opencorvus-capture/1782540923070-jbqnrq/manifest.json",
      review_status: "reviewed_with_blocking_debt",
      review_summary: "Rendered skeleton preview was compared against the source reference.",
    }),
  ).rejects.toThrow("diff_artifact")

  await expect(
    callTool(kit.tools, "update_frontend_visual_evidence", {
      id: "desktop",
      render_target: "visual-html-skeleton",
      rendered_entrypoint: "visual-html-skeleton/index.html",
      screenshot_artifact: durablePreview,
      source_reference_artifact: "web-clone-source/reference.png",
      renderer: "task_scoped_backend_browser",
      viewport: "1440x900",
      screenshot_sha256: "a".repeat(64),
      source_reference_sha256: "b".repeat(64),
      diff_artifact: "visual-html-skeleton/visual-diffs/desktop.json",
      review_status: "reviewed_with_blocking_debt",
      review_summary: "Rendered skeleton preview was compared against the source reference.",
    }),
  ).resolves.toContain("OK")
})

test("update_frontend tools assemble and finalize the canonical frontend template", async () => {
  const kit = await registerMinimalFrontendResult()

  const result = await callTool(kit.tools, "submit_frontend_template", { final: true })

  expect(result).toContain("OK")
  expect(kit.getCollector().final?.frontend_template).toContain("Desktop page skeleton")
  expect(kit.getCollector().final?.component_reuse_plan[0]?.family_id).toBe("market-card-grid")
  expect(kit.getCollector().final?.implementation_phase_outcomes).toHaveLength(5)
})
