import { expect, test } from "bun:test"
import { asSchema } from "ai"
import { createHash } from "node:crypto"
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

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex")
}

async function createVisualBaselineFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-visual-baseline-evidence-"))
  const visualRoot = path.join(root, "visual-html-skeleton")
  const screenshotsRoot = path.join(visualRoot, "screenshots")
  const sourceRoot = path.join(root, "web-clone-source")
  await fs.mkdir(screenshotsRoot, { recursive: true })
  await fs.mkdir(sourceRoot, { recursive: true })
  const entrypoint = path.join(visualRoot, "index.html")
  const referenceEntrypoint = path.join(root, "reference-source.html")
  await fs.writeFile(
    entrypoint,
    `<!doctype html>
      <html>
        <head><title>Full page skeleton</title></head>
        <body style="margin:0;background:#f8fafc">
          <main style="width:320px;height:420px;background:linear-gradient(#0f172a,#14b8a6);color:white;font:16px Arial,sans-serif">
            <h1 style="margin:0;padding:24px">World economy</h1>
            <section style="margin:24px;height:300px;background:rgba(255,255,255,.18)">Long source-backed region</section>
          </main>
        </body>
      </html>`,
    "utf8",
  )
  await fs.writeFile(
    referenceEntrypoint,
    `<!doctype html>
      <html>
        <head><title>Source reference</title></head>
        <body style="margin:0;background:#ffffff">
          <main style="width:320px;height:180px;background:#e2e8f0;color:#111827;font:16px Arial,sans-serif">
            <h1 style="margin:0;padding:24px">Source reference</h1>
          </main>
        </body>
      </html>`,
    "utf8",
  )
  const screenshot = await renderVisualHtmlSkeletonScreenshotForValidation({
    entrypointFile: entrypoint,
    viewport: { width: 320, height: 180 },
    captureMode: "full_page",
    timeoutMs: 10_000,
  })
  const reference = await renderVisualHtmlSkeletonScreenshotForValidation({
    entrypointFile: referenceEntrypoint,
    viewport: { width: 320, height: 180 },
    captureMode: "viewport",
    timeoutMs: 10_000,
  })
  await fs.writeFile(path.join(screenshotsRoot, "desktop-full-page.png"), screenshot)
  await fs.writeFile(path.join(sourceRoot, "reference.png"), reference)
  return {
    root,
    screenshotSha256: sha256(screenshot),
    sourceReferenceSha256: sha256(reference),
  }
}

async function registerMinimalFrontendResult(
  kit = createFrontendTemplateOutputTools(),
  options: { includeDesignDirections?: boolean; selectDesignDirection?: boolean; includeAntiSlopReview?: boolean } = {},
) {
  const { tools } = kit
  const includeDesignDirections = options.includeDesignDirections ?? true
  const shouldSelectDesignDirection = options.selectDesignDirection ?? true
  const includeAntiSlopReview = options.includeAntiSlopReview ?? true
  await callTool(tools, "update_frontend_basics", {
    design_system: "source-backed custom visual system",
    tech_stack: ["React", "Vite", "CSS modules", "local fixture data"],
    final_acceptance_mode: "maintainable_replacement_required",
  })
  if (includeDesignDirections) {
    await callTool(tools, "update_frontend_design_direction", {
      id: "direction-operator-console",
      name: "Operator console",
      concept: "Dense enterprise console with table-first scanning, calm status surfaces, and restrained emphasis.",
      evidence_refs: ["web-clone-source/reference.png", "web-clone-source/source-ir/style-tokens.json"],
      tradeoffs: "Best fit for repeated financial rows and high-frequency comparison, but needs careful hierarchy control.",
      implementation_notes: "Build reusable metric cards, row groups, and status bands from local fixture data.",
    })
    await callTool(tools, "update_frontend_design_direction", {
      id: "direction-editorial-dashboard",
      name: "Editorial dashboard",
      concept: "A more narrative dashboard with larger summary modules and stronger section pacing.",
      evidence_refs: ["web-clone-source/reference.png"],
      tradeoffs: "Readable first impression, but weaker for dense market scanning and repeated operational use.",
      implementation_notes: "Would prioritize hero summaries and fewer dense comparison regions.",
    })
  }
  if (includeDesignDirections && shouldSelectDesignDirection) {
    await callTool(tools, "select_frontend_design_direction", {
      id: "direction-operator-console",
    })
  }
  if (includeAntiSlopReview) {
    await callTool(tools, "update_frontend_anti_slop_review", {
      id: "anti-slop-generic-cards",
      rejected_trait: "Generic card-heavy SaaS layout with decorative gradients.",
      evidence: "The source evidence is dense financial scanning UI, not a marketing dashboard.",
      correction: "Use compact table/card hybrids, restrained status color, and task-focused grouping.",
    })
  }
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

async function registerVisualBaselineResult(
  kit: ReturnType<typeof createFrontendTemplateOutputTools>,
  evidence: {
    captureMode: "viewport" | "full_page"
    screenshotSha256: string
    sourceReferenceSha256: string
  },
) {
  const { tools } = kit
  await callTool(tools, "update_frontend_basics", {
    design_system: "source-backed static visual baseline",
    tech_stack: ["static HTML", "CSS", "Node Playwright visual evidence"],
    final_acceptance_mode: "visual_baseline_allowed",
  })
  await callTool(tools, "update_frontend_item", {
    target: "frontend_template_sections",
    item: {
      title: "Desktop static skeleton",
      detail: "Render visual-html-skeleton/index.html as the source-editable first workflow surface.",
      source_refs: ["web-clone-source/reference.png"],
    },
  })
  await callTool(tools, "update_frontend_item", {
    target: "fillable_module_items",
    item: {
      title: "Long visual section",
      detail: "The restored HTML skeleton owns a long page section that extends beyond the initial viewport.",
      source_refs: ["web-clone-source/reference.png"],
    },
  })
  await callTool(tools, "update_frontend_component_reuse", {
    family_id: "static-shell",
    name: "Static shell",
    observed_surface: "Source-editable visual HTML skeleton shell.",
    source_refs: ["visual-html-skeleton/index.html", "web-clone-source/reference.png"],
    implementation_strategy: "extracted_baseline_defer",
    reuse_source: "visual-html-skeleton/index.html",
    mature_library_candidates: [],
    props_states: "Static desktop visual state.",
    replacement_boundary: "The later workflow transcribes the static shell into maintainable source.",
    parity_guard: "Use the registered rendered screenshot evidence before downstream transcription.",
    project_specific_reason: "",
  })
  await callTool(tools, "update_frontend_item", {
    target: "quality_project_items",
    item: {
      title: "Skeleton transcription contract",
      detail: "Downstream work transcribes the accepted HTML/CSS skeleton into maintainable project modules.",
      source_refs: ["visual-html-skeleton/index.html"],
    },
  })
  await callTool(tools, "update_frontend_material", {
    title: "Visual source materials",
    detail: "Reference pixels and rendered skeleton screenshots bind the static visual baseline.",
    source_refs: ["web-clone-source/reference.png"],
  })
  await callTool(tools, "update_frontend_project", {
    status: "created",
    role: "visual_baseline_input",
    project_root: "visual-html-skeleton",
    source_package: "web-clone-source",
    entrypoints: ["visual-html-skeleton/index.html"],
    generation_tool: "node-playwright-static-file",
    notes: ["Source-editable static HTML/CSS skeleton with structured screenshot evidence."],
  })
  await callTool(tools, "update_frontend_item", {
    target: "visual_consistency_items",
    item: {
      title: "Rendered screenshot evidence",
      detail: "The skeleton screenshot is materialized under visual-html-skeleton and compared with web-clone-source/reference.png.",
      source_refs: ["web-clone-source/reference.png"],
    },
  })
  await callTool(tools, "update_frontend_visual_evidence", {
    id: "desktop-full-page",
    render_target: "visual-html-skeleton",
    rendered_entrypoint: "visual-html-skeleton/index.html",
    screenshot_artifact: "visual-html-skeleton/screenshots/desktop-full-page.png",
    source_reference_artifact: "web-clone-source/reference.png",
    renderer: "node_playwright_static_file",
    viewport: "desktop-320x180",
    capture_mode: evidence.captureMode,
    screenshot_sha256: evidence.screenshotSha256,
    source_reference_sha256: evidence.sourceReferenceSha256,
    diff_artifact: "",
    review_status: "reviewed_no_blocking_debt",
    review_summary: "Rendered static skeleton screenshot was reviewed against the source reference.",
  })
  await callTool(tools, "update_frontend_item", {
    target: "ui_data_contract_items",
    item: {
      title: "Static visual data",
      detail: "The current workflow uses static source-backed visible text only.",
      source_refs: ["visual-html-skeleton/index.html"],
    },
  })
  await callTool(tools, "update_frontend_iteration_note", {
    value: "Reviewed source-editable skeleton evidence and screenshot provenance before finalization.",
  })
  await callTool(tools, "update_frontend_iteration_note", {
    value: "Reviewed downstream transcription contract against the registered visual evidence.",
  })
  await callTool(tools, "update_frontend_text", {
    section: "completeness_review",
    content: "The visual baseline evidence is complete for downstream transcription of the source-editable skeleton.",
  })
}

test("submit_frontend_template exposes a small finalizer schema", () => {
  const schema = asSchema(createFrontendTemplateOutputTools().tools.submit_frontend_template.inputSchema)
    .jsonSchema as any

  expect(Object.keys(schema.properties ?? {}).sort()).toEqual(["fact_check_items", "final"])
  expect(schema.properties).not.toHaveProperty("frontend_template")
  expect(schema.properties).not.toHaveProperty("component_reuse_plan")
})

test("register_layout_spec rejects source-capture geometry before it enters visual requirements", async () => {
  const kit = createFrontendTemplateOutputTools()

  const rejectedVisible = await callTool(kit.tools, "register_layout_spec", {
    id: "vis-layout-source-footer-y",
    title: "Source footer y",
    section_role: "footer",
    position: "source y=5222",
    dimensions: "source height 976px",
    layout_method: "flow",
    coordinate_space: "source_capture_viewport_px",
    implementation_use: "visible_layout_constraint",
    applies_to: "web-clone-source/reference.png",
    severity: "must",
  })
  expect(rejectedVisible).toContain("source_capture_viewport_px geometry is source evidence")

  const rejectedEvidenceOnly = await callTool(kit.tools, "register_layout_spec", {
    id: "vis-layout-source-footer-y-evidence",
    title: "Source footer y evidence",
    section_role: "footer",
    position: "source y=5222",
    dimensions: "source height 976px",
    layout_method: "flow",
    coordinate_space: "source_capture_viewport_px",
    implementation_use: "evidence_only",
    applies_to: "web-clone-source/reference.png",
    severity: "must",
  })
  expect(rejectedEvidenceOnly).toContain("source_capture_viewport_px geometry is source evidence")

  const accepted = await callTool(kit.tools, "register_layout_spec", {
    id: "vis-layout-header",
    title: "Header layout",
    section_role: "header",
    position: "top",
    dimensions: "full-width 64px height",
    layout_method: "sticky",
    coordinate_space: "implementation_layout",
    implementation_use: "visible_layout_constraint",
    applies_to: "header",
    severity: "must",
  })
  expect(accepted).toContain("OK")
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
        captureMode: "viewport",
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
      capture_mode: "viewport",
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
      capture_mode: "viewport",
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
      capture_mode: "viewport",
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
      capture_mode: "viewport",
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
      capture_mode: "viewport",
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
      capture_mode: "viewport",
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
  expect(kit.getCollector().final?.design_directions).toHaveLength(2)
  expect(kit.getCollector().final?.selected_design_direction_id).toBe("direction-operator-console")
  expect(kit.getCollector().final?.anti_slop_review[0]?.id).toBe("anti-slop-generic-cards")
  expect(kit.getCollector().final?.component_reuse_plan[0]?.family_id).toBe("market-card-grid")
  expect(kit.getCollector().final?.implementation_phase_outcomes).toHaveLength(5)
  expect(kit.buildReport().detail).toContain("## Design Directions")
  expect(kit.buildReport().detail).toContain("## Selected Design Direction\ndirection-operator-console")
  expect(kit.buildReport().detail).toContain("## Anti-Slop Review")
})

test("frontend design directions must be selected before final submit", async () => {
  const kit = await registerMinimalFrontendResult(createFrontendTemplateOutputTools(), {
    selectDesignDirection: false,
  })

  const status = await callTool(kit.tools, "inspect_frontend_result_status", {})
  const result = await callTool(kit.tools, "submit_frontend_template", { final: true })

  expect(status).toContain("design_directions=2")
  expect(status).toContain("select_frontend_design_direction")
  expect(result).toContain("MISSING_FRONTEND_TEMPLATE_RESULT")
  expect(result).toContain("select_frontend_design_direction")
  expect(kit.getCollector().final).toBeUndefined()
})

test("select_frontend_design_direction rejects unknown direction ids", async () => {
  const kit = createFrontendTemplateOutputTools()

  const result = await callTool(kit.tools, "select_frontend_design_direction", {
    id: "direction-missing",
  })

  expect(result).toContain('Error: selected design direction "direction-missing" is not registered')
})

test("ordinary frontend template submit does not require frontend innovate directions", async () => {
  const kit = await registerMinimalFrontendResult(createFrontendTemplateOutputTools(), {
    includeDesignDirections: false,
    includeAntiSlopReview: false,
  })

  const result = await callTool(kit.tools, "submit_frontend_template", { final: true })

  expect(result).toContain("OK")
  expect(kit.getCollector().final?.design_directions).toEqual([])
  expect(kit.getCollector().final?.anti_slop_review).toEqual([])
})

test("frontend innovate submit requires multiple directions, selection, and anti-slop review", async () => {
  const missingDirections = await registerMinimalFrontendResult(
    createFrontendTemplateOutputTools({ requireFrontendInnovateContract: true }),
    {
      includeDesignDirections: false,
      includeAntiSlopReview: true,
    },
  )
  expect(await callTool(missingDirections.tools, "submit_frontend_template", { final: true })).toContain(
    "frontend-innovate handoff requires at least two resource-backed design_directions",
  )

  const missingSelection = await registerMinimalFrontendResult(
    createFrontendTemplateOutputTools({ requireFrontendInnovateContract: true }),
    {
      includeDesignDirections: true,
      selectDesignDirection: false,
      includeAntiSlopReview: true,
    },
  )
  expect(await callTool(missingSelection.tools, "submit_frontend_template", { final: true })).toContain(
    "select_frontend_design_direction({ id })",
  )

  const missingAntiSlop = await registerMinimalFrontendResult(
    createFrontendTemplateOutputTools({ requireFrontendInnovateContract: true }),
    {
      includeDesignDirections: true,
      includeAntiSlopReview: false,
    },
  )
  expect(await callTool(missingAntiSlop.tools, "submit_frontend_template", { final: true })).toContain(
    "frontend-innovate handoff requires anti_slop_review",
  )
})

test(
  "visual baseline submit validates full-page screenshot evidence with explicit capture mode",
  async () => {
    const fixture = await createVisualBaselineFixture()
    const kit = createFrontendTemplateOutputTools({
      artifactRoot: fixture.root,
      workspaceRoot: fixture.root,
    })
    await registerVisualBaselineResult(kit, {
      captureMode: "full_page",
      screenshotSha256: fixture.screenshotSha256,
      sourceReferenceSha256: fixture.sourceReferenceSha256,
    })

    const status = await callTool(kit.tools, "inspect_frontend_result_status", {})
    const result = await callTool(kit.tools, "submit_frontend_template", { final: true })

    expect(status).toContain("FRONTEND_TEMPLATE_RESULT_STATUS: ready_for_submit_validation")
    expect(result).toContain("OK")
    expect(kit.getCollector().final?.visual_validation_evidence[0]?.capture_mode).toBe("full_page")
  },
  30_000,
)

test(
  "visual baseline status blocks full-page evidence declared as viewport capture",
  async () => {
    const fixture = await createVisualBaselineFixture()
    const kit = createFrontendTemplateOutputTools({
      artifactRoot: fixture.root,
      workspaceRoot: fixture.root,
    })
    await registerVisualBaselineResult(kit, {
      captureMode: "viewport",
      screenshotSha256: fixture.screenshotSha256,
      sourceReferenceSha256: fixture.sourceReferenceSha256,
    })

    const status = await callTool(kit.tools, "inspect_frontend_result_status", {})
    const result = await callTool(kit.tools, "submit_frontend_template", { final: true })

    expect(status).toContain("FRONTEND_TEMPLATE_RESULT_STATUS: blocked_by_visual_evidence")
    expect(status).toContain("rendered_entrypoint_hash_mismatch")
    expect(result).toContain("frontend template failed final validation")
    expect(result).toContain("rendered_entrypoint_hash_mismatch")
    expect(kit.getCollector().final).toBeUndefined()
  },
  30_000,
)
