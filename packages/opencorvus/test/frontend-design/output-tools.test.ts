import { expect, test } from "bun:test"
import { asSchema } from "ai"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  buildFrontendTemplateReport,
  createFrontendTemplateOutputTools,
  renderVisualHtmlSkeletonScreenshotForValidation,
} from "../../src/frontend-design/output-tools"

const materialInventoryItems = [
  {
    title: "Source materials",
    detail: "Use reference pixels, source CSS tokens, assets, and fixture data required by the frontend skeleton.",
    source_refs: ["web-clone-source/reference.png"],
  },
]

const implementationPhaseOutcomes = [
  {
    id: "phase-evidence-lock",
    phase: "evidence_lock" as const,
    title: "Evidence lock",
    deliverable: "Lock source screenshots, source IR, component inventory, and package evidence before implementation.",
    source_refs: ["web-clone-source/reference.png", "web-clone-source/source-ir/component-tree.json"],
    acceptance: "Final implementation work cites the locked source evidence instead of re-extracting or guessing.",
  },
  {
    id: "phase-implementation-scaffold",
    phase: "implementation_scaffold" as const,
    title: "Implementation scaffold",
    deliverable: "Bind the maintainable implementation to a real project scaffold and runtime entrypoints.",
    source_refs: ["package.json", "src/main.tsx"],
    acceptance: "The implementation target root and entrypoints resolve to real project files.",
  },
  {
    id: "phase-data-component-transcription",
    phase: "data_component_transcription" as const,
    title: "Data and component transcription",
    deliverable: "Transcribe repeated source content into data modules and semantic component families.",
    source_refs: ["web-clone-source/source-ir/content-model.json"],
    acceptance: "Rows, cards, controls, and charts render from structured data and component props.",
  },
  {
    id: "phase-runtime-visual-verification",
    phase: "runtime_visual_verification" as const,
    title: "Runtime and visual verification",
    deliverable: "Verify the running project against reference screenshots and interaction-state evidence.",
    source_refs: ["web-clone-source/reference.png"],
    acceptance: "Reference-vs-implementation visual evidence is captured for the desktop clone target.",
  },
  {
    id: "phase-source-quality-cleanup",
    phase: "source_quality_cleanup" as const,
    title: "Source quality cleanup",
    deliverable: "Remove generated/static skeleton debt and verify design-system component usage.",
    source_refs: ["web-clone-source/web-clone-implementation-contract.json"],
    acceptance:
      "No screenshot wrappers, primitive substitutes, raw generated DOM dumps, or unverified library claims remain.",
  },
]

const sourceReferenceSha = "b".repeat(64)
const sourceReferencePng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNgYGD4DwABBAEAghnFoQAAAABJRU5ErkJggg==",
  "base64",
)

function forgedPngHeader(): Buffer {
  const bytes = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0)
  bytes.writeUInt32BE(13, 8)
  bytes.write("IHDR", 12, "ascii")
  bytes.writeUInt32BE(1, 16)
  bytes.writeUInt32BE(1, 20)
  bytes[24] = 8
  bytes[25] = 6
  return bytes
}

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex")
}

async function createVisualEvidenceFixture(overrides: Record<string, unknown> = {}) {
  const artifactRoot = await fs.mkdtemp(path.join(os.tmpdir(), "frontend-visual-evidence-"))
  const diffBytes = Buffer.from('{"mismatchPixels":0}\n', "utf8")

  await fs.mkdir(path.join(artifactRoot, "visual-html-skeleton", "screenshots"), { recursive: true })
  await fs.mkdir(path.join(artifactRoot, "visual-html-skeleton"), { recursive: true })
  await fs.mkdir(path.join(artifactRoot, "web-clone-source"), { recursive: true })
  const entrypoint = path.join(artifactRoot, "visual-html-skeleton", "index.html")
  await fs.writeFile(
    entrypoint,
    [
      "<!doctype html>",
      '<meta charset="utf-8">',
      "<style>",
      "html, body { margin: 0; width: 100%; height: 100%; background: rgb(8, 22, 37); }",
      "main { width: 100vw; height: 100vh; background: linear-gradient(135deg, rgb(8, 22, 37), rgb(34, 92, 126)); }",
      "</style>",
      "<main></main>",
    ].join("\n"),
  )
  const renderedScreenshotPng = await renderVisualHtmlSkeletonScreenshotForValidation({
    entrypointFile: entrypoint,
    viewport: { width: 320, height: 180 },
  })
  await fs.writeFile(
    path.join(artifactRoot, "visual-html-skeleton", "screenshots", "desktop.png"),
    renderedScreenshotPng,
  )
  await fs.writeFile(path.join(artifactRoot, "web-clone-source", "reference.png"), sourceReferencePng)
  await fs.writeFile(path.join(artifactRoot, "visual-html-skeleton", "visual-diff.json"), diffBytes)

  return {
    artifactRoot,
    evidence: visualValidationEvidence({
      screenshot_sha256: sha256(renderedScreenshotPng),
      source_reference_sha256: sha256(sourceReferencePng),
      ...overrides,
    }),
  }
}

async function createImplementationProjectFixture(dependencies: Record<string, string> = {}) {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "frontend-implementation-target-"))
  const projectRoot = "app"
  const projectDir = path.join(workspaceRoot, projectRoot)
  await fs.mkdir(path.join(projectDir, "src"), { recursive: true })
  await fs.writeFile(path.join(projectDir, "package.json"), JSON.stringify({ dependencies }, null, 2))
  await fs.writeFile(path.join(projectDir, "src", "main.tsx"), "export const app = true\n")
  return { workspaceRoot, projectRoot }
}

function maintainableImplementationPayload(overrides: Record<string, unknown> = {}) {
  return {
    design_system: "AInvest component system",
    tech_stack: ["React", "Vite"],
    final_acceptance_mode: "maintainable_replacement_required",
    frontend_template: "Production-mergeable page using real components.",
    fillable_modules: "Implementation modules.",
    component_inventory: "Data table and page shell components.",
    component_reuse_plan: [
      {
        family_id: "comp-table",
        name: "Data table",
        observed_surface: "Main data table",
        source_refs: ["web-clone-source/reference.png"],
        implementation_strategy: "project_specific_component",
        reuse_source: "src/components/DataTable.tsx",
        mature_library_candidates: [],
        props_states: "rows, columns, hover",
        replacement_boundary: "table region",
        parity_guard: "visual diff",
        project_specific_reason: "No installed mature library is required for this minimal fixture.",
      },
    ],
    baseline_replacement_plan: [],
    implementation_phase_outcomes: implementationPhaseOutcomes,
    material_inventory: "AInvest tokens and source data.",
    material_inventory_items: materialInventoryItems,
    visual_consistency_contract: "Match the reference visual density and component states.",
    ui_data_contract: "Static fixture data.",
    frontend_project: {
      status: "created",
      role: "source_baseline_input",
      project_root: "frontend-design-skeleton",
      source_package: "web-clone-source",
      entrypoints: ["README.md", "src/App.tsx", "src/styles.css"],
      generation_tool: "host-prepared:create_frontend_skeleton_project",
      notes: ["source baseline ready"],
    },
    template_iteration_notes: ["checked production handoff", "checked downstream implementation handoff"],
    completeness_review: "complete enough",
    reference_artifacts: ["web-clone-source/reference.png"],
    open_questions: [],
    ...overrides,
  }
}

function visualValidationEvidence(overrides: Record<string, unknown> = {}) {
  return [
    {
      id: "visual-render-desktop",
      render_target: "visual-html-skeleton",
      rendered_entrypoint: "visual-html-skeleton/index.html",
      screenshot_artifact: "visual-html-skeleton/screenshots/desktop.png",
      source_reference_artifact: "web-clone-source/reference.png",
      renderer: "node_playwright_static_file",
      viewport: "desktop-320x180",
      screenshot_sha256: "a".repeat(64),
      source_reference_sha256: sourceReferenceSha,
      diff_artifact: "visual-html-skeleton/visual-diff.json",
      review_status: "reviewed_no_blocking_debt",
      review_summary: "Rendered skeleton screenshot was compared against the source reference with no blocking debt.",
      ...overrides,
    },
  ]
}

async function writeSourceStructureContentModel(artifactRoot: string) {
  const dir = path.join(artifactRoot, "web-clone-source", "source-ir")
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(
    path.join(dir, "content-model.json"),
    JSON.stringify(
      {
        repeatedGroups: [
          {
            itemTag: "section",
            sampleTexts: [
              "Economic trends Inflation map GDP growth India Indonesia rates currencies bonds",
              "Countries Argentina Australia Brazil Canada China France Germany India",
              "Ideas Popular Recent Video Different semiconductor cycle inflation markets",
            ],
          },
        ],
      },
      null,
      2,
    ),
  )
}

async function writeVisualSkeletonHtmlAndEvidence(input: {
  artifactRoot: string
  html: string
}): Promise<ReturnType<typeof visualValidationEvidence>> {
  const entrypoint = path.join(input.artifactRoot, "visual-html-skeleton", "index.html")
  await fs.writeFile(entrypoint, input.html)
  const renderedScreenshotPng = await renderVisualHtmlSkeletonScreenshotForValidation({
    entrypointFile: entrypoint,
    viewport: { width: 320, height: 180 },
  })
  await fs.writeFile(
    path.join(input.artifactRoot, "visual-html-skeleton", "screenshots", "desktop.png"),
    renderedScreenshotPng,
  )
  return visualValidationEvidence({
    screenshot_sha256: sha256(renderedScreenshotPng),
    source_reference_sha256: sha256(sourceReferencePng),
  })
}

function visualBaselinePayload(
  fixture: Awaited<ReturnType<typeof createVisualEvidenceFixture>>,
  overrides: Record<string, unknown> = {},
) {
  return {
    design_system: "source-derived static visual baseline",
    tech_stack: ["static HTML", "CSS", "Playwright visual diff"],
    final_acceptance_mode: "visual_baseline_allowed",
    frontend_template: "Restore a source-derived visual HTML skeleton.",
    fillable_modules: "Economic trends, Countries, and Ideas source sections.",
    component_inventory: "Static visual skeleton content sections.",
    component_reuse_plan: [
      {
        family_id: "comp-static-skeleton",
        name: "Static visual skeleton",
        observed_surface: "Full captured page first viewport",
        source_refs: ["web-clone-source/reference.png", "web-clone-source/source-ir/content-model.json"],
        implementation_strategy: "extracted_baseline_defer",
        reuse_source: "visual-html-skeleton/index.html",
        mature_library_candidates: [],
        props_states: "static representative visual states only",
        replacement_boundary: "visual skeleton root",
        parity_guard: "Compare skeleton screenshot against source reference.png before transcription.",
        project_specific_reason: "not applicable",
      },
    ],
    material_inventory: "Source content model and reference pixels.",
    material_inventory_items: materialInventoryItems,
    visual_consistency_contract: "Match source order, density, and visible section content.",
    ui_data_contract: "Static content from source-ir/content-model.json.",
    frontend_project: {
      status: "created",
      role: "visual_baseline_input",
      project_root: "visual-html-skeleton",
      source_package: "web-clone-source",
      entrypoints: [
        "visual-html-skeleton/index.html",
        "visual-html-skeleton/screenshots/desktop.png",
        "visual-html-skeleton/visual-diff.json",
      ],
      generation_tool: "source-ir-static-html-skeleton",
      notes: ["Derived from source IR and rendered with no blocking visual debt."],
    },
    visual_validation_evidence: fixture.evidence,
    template_iteration_notes: ["checked visual skeleton source structure and screenshot evidence", "checked downstream implementation handoff"],
    completeness_review: "Rendered screenshot review found no blocking visual debt.",
    reference_artifacts: ["web-clone-source/reference.png", "visual-html-skeleton/index.html"],
    open_questions: [],
    ...overrides,
  }
}

test("submit_frontend_template defaults missing fact_check_items during direct execution", async () => {
  const kit = createFrontendTemplateOutputTools()

  const out = await kit.tools.submit_frontend_template.execute!(
    {
      design_system: "custom chart workspace",
      tech_stack: ["React", "mock API"],
      final_acceptance_mode: "visual_baseline_allowed",
      frontend_template: "# Chart Page\nReplica page with chart, toolbar, and sidebar.",
      fillable_modules: "Implement chart layout, header controls, sidebars, and responsive states.",
      component_inventory: "Chart shell, toolbar, and sidebar components.",
      component_reuse_plan: [
        {
          family_id: "comp-chart-shell",
          name: "Chart shell",
          observed_surface: "Main chart area",
          source_refs: ["webpage-evidence/reference.png"],
          implementation_strategy: "mature_library",
          reuse_source: "lightweight-charts",
          mature_library_candidates: ["lightweight-charts"],
          props_states: "series data, crosshair state, hover state",
          replacement_boundary: "Replace chart DOM region only after parity screenshot passes.",
          parity_guard: "Compare rendered chart against reference.png.",
          project_specific_reason: "not applicable",
        },
      ],
      baseline_replacement_plan: [],
      material_inventory: "Quote/candle fixture data and chart visual tokens.",
      material_inventory_items: materialInventoryItems,
      visual_consistency_contract: "Match the observed chart workspace spacing, colors, and control density.",
      ui_data_contract: "Provide local quote and candle endpoints with deterministic mock data.",
      template_iteration_notes: ["Checked page inventory and downstream implementability.", "checked downstream implementation handoff"],
      completeness_review: "Complete enough for requirements and architect handoff.",
      reference_artifacts: [],
      open_questions: [],
    } as any,
    {} as any,
  )

  expect(out).toContain("OK")
  expect(kit.getCollector().final?.fact_check_items).toEqual([])
  expect(kit.getCollector().final?.final_acceptance_mode).toBe("visual_baseline_allowed")
})

test("submit_frontend_template provider schema requires explicit final_acceptance_mode", () => {
  const schema = asSchema(createFrontendTemplateOutputTools().tools.submit_frontend_template.inputSchema).jsonSchema

  expect(schema.required).toContain("final_acceptance_mode")
  expect(schema.properties?.final_acceptance_mode).not.toHaveProperty("default")
})

test("submit_frontend_template tolerates missing review fields from provider tool calls", async () => {
  const kit = createFrontendTemplateOutputTools()
  const submit = kit.tools.submit_frontend_template as any

  const out = await submit.execute(
    {
      design_system: "custom financial page",
      tech_stack: ["React", "Vite"],
      final_acceptance_mode: "maintainable_replacement_required",
      frontend_template: "frontend template",
      fillable_modules: "fillable modules",
      component_inventory: "component inventory",
      component_reuse_plan: [
        {
          family_id: "comp-table",
          name: "Market table",
          observed_surface: "Country metrics table",
          source_refs: [],
          implementation_strategy: "mature_library",
          reuse_source: "@tanstack/react-table",
          mature_library_candidates: ["@tanstack/react-table"],
          props_states: "rows and columns",
          replacement_boundary: "table skeleton slot",
          parity_guard: "visual diff",
          project_specific_reason: "not applicable",
        },
      ],
      baseline_replacement_plan: [
        {
          boundary_id: "replace-market-table",
          source_region: "table skeleton slot",
          action: "replace_generated_baseline",
          component_family_id: "comp-table",
          replacement_strategy: "mature_library",
          reuse_source: "@tanstack/react-table",
          mature_library_candidates: ["@tanstack/react-table"],
          deletion_rule: "Remove generated table DOM after parity passes.",
          source_refs: [],
          parity_guard: "visual diff and source audit",
          project_specific_reason: "not applicable",
        },
      ],
      implementation_phase_outcomes: implementationPhaseOutcomes,
      material_inventory: "materials",
      material_inventory_items: materialInventoryItems,
      visual_consistency_contract: "visual contract",
      ui_data_contract: "data contract",
    },
    {},
  )

  expect(out).toContain("OK")
  expect(kit.getCollector().final?.template_iteration_notes).toHaveLength(2)
  expect(kit.getCollector().final?.completeness_review).toContain("structurally complete")
})

test("submit_frontend_template normalizes markdown open questions", async () => {
  const kit = createFrontendTemplateOutputTools()
  const submit = kit.tools.submit_frontend_template as any

  await submit.execute(
    {
      design_system: "custom financial page",
      tech_stack: ["React", "Vite"],
      final_acceptance_mode: "maintainable_replacement_required",
      frontend_template: "frontend template",
      fillable_modules: "fillable modules",
      component_inventory: "component inventory",
      component_reuse_plan: [
        {
          family_id: "comp-table",
          name: "Market table",
          observed_surface: "Country metrics table",
          source_refs: [],
          implementation_strategy: "mature_library",
          reuse_source: "@tanstack/react-table",
          mature_library_candidates: ["@tanstack/react-table"],
          props_states: "rows and columns",
          replacement_boundary: "table skeleton slot",
          parity_guard: "visual diff",
          project_specific_reason: "not applicable",
        },
      ],
      material_inventory: "materials",
      material_inventory_items: materialInventoryItems,
      visual_consistency_contract: "visual contract",
      ui_data_contract: "data contract",
      implementation_phase_outcomes: implementationPhaseOutcomes,
      frontend_project: {
        status: "created",
        role: "source_baseline_input",
        project_root: "frontend-design-skeleton",
        source_package: "web-clone-source",
        entrypoints: ["README.md", "src/App.tsx", "src/styles.css"],
        generation_tool: "host-prepared:create_frontend_skeleton_project",
        notes: ["source baseline ready"],
      },
      template_iteration_notes: ["checked inventory", "checked downstream implementation handoff"],
      completeness_review: "complete enough",
      open_questions: "- right toolbar capture ambiguity\n- exact 1600px max width",
    },
    {},
  )

  expect(kit.getCollector().final?.open_questions).toEqual([
    "right toolbar capture ambiguity",
    "exact 1600px max width",
  ])
})

test("submit_frontend_template rebuilds flattened frontend_project provider args", async () => {
  const kit = createFrontendTemplateOutputTools()
  const submit = kit.tools.submit_frontend_template as any

  await submit.execute(
    {
      design_system: "custom financial page",
      tech_stack: ["React", "Vite"],
      final_acceptance_mode: "visual_baseline_allowed",
      frontend_template: "frontend template",
      fillable_modules: "fillable modules",
      component_inventory: "component inventory",
      component_reuse_plan: [
        {
          family_id: "comp-table",
          name: "Market table",
          observed_surface: "Country metrics table",
          source_refs: [],
          implementation_strategy: "mature_library",
          reuse_source: "@tanstack/react-table",
          mature_library_candidates: ["@tanstack/react-table"],
          props_states: "rows and columns",
          replacement_boundary: "table skeleton slot",
          parity_guard: "visual diff",
          project_specific_reason: "not applicable",
        },
      ],
      baseline_replacement_plan: [],
      implementation_phase_outcomes: implementationPhaseOutcomes,
      material_inventory: "materials",
      material_inventory_items: materialInventoryItems,
      visual_consistency_contract: "visual contract",
      ui_data_contract: "data contract",
      template_iteration_notes: ["checked inventory", "checked downstream implementation handoff"],
      completeness_review: "complete enough",
      "frontend_project<arg_key>status": "created",
      "frontend_project<arg_key>role": "source_baseline_input",
      "frontend_project<arg_key>project_root": "frontend-design-skeleton",
      "frontend_project<arg_key>source_package": "web-clone-source",
      "frontend_project<arg_key>entrypoints": '["README.md","src/App.tsx"]',
      "frontend_project<arg_key>generation_tool": "host-prepared:create_frontend_skeleton_project",
      "frontend_project<arg_key>notes": '["source skeleton ready"]',
    },
    {},
  )

  const project = kit.getCollector().final?.frontend_project
  expect(project?.status).toBe("created")
  expect(project?.project_root).toBe("frontend-design-skeleton")
  expect(project?.entrypoints).toEqual(["README.md", "src/App.tsx"])
  expect(project?.notes).toEqual(["source skeleton ready"])
})

test("submit_frontend_template provider schema stays compact while preserving core fields", () => {
  const schema = asSchema(createFrontendTemplateOutputTools().tools.submit_frontend_template.inputSchema).jsonSchema
  const schemaText = JSON.stringify(schema)

  expect(schemaText.length).toBeLessThan(12_000)
  expect(schema.properties?.final_acceptance_mode).toBeDefined()
  expect(schema.properties?.component_reuse_plan).toBeDefined()
  expect(schema.required).toContain("material_inventory_items")
  expect(schema.properties?.material_inventory_items).toHaveProperty("minItems", 1)
  expect(schema.properties?.frontend_project).toBeDefined()
  expect(schema.properties).not.toHaveProperty("fact_check_items")
})

test("submit_frontend_template renders compact structured fields into markdown handoff", async () => {
  const kit = createFrontendTemplateOutputTools()
  const submit = kit.tools.submit_frontend_template as any

  await submit.execute(
    {
      design_system: "custom financial page",
      tech_stack: ["React", "Vite"],
      final_acceptance_mode: "maintainable_replacement_required",
      frontend_template_sections: [
        {
          title: "Route",
          detail: "Render /markets from frontend-design-skeleton plus semantic replacement slots.",
          source_refs: ["web-clone-source/implementation-blueprint.md"],
        },
      ],
      fillable_module_items: [
        {
          title: "Markets table",
          detail: "Render table rows from data arrays and preserve sticky first column.",
          source_refs: ["web-clone-source/source-ir/content-model.json"],
        },
      ],
      component_reuse_plan: [
        {
          family_id: "comp-table",
          name: "Market table",
          observed_surface: "Country metrics table",
          source_refs: ["web-clone-source/source-ir/content-model.json"],
          implementation_strategy: "mature_library",
          reuse_source: "@tanstack/react-table",
          mature_library_candidates: ["@tanstack/react-table"],
          props_states: "rows, columns, scroll state",
          replacement_boundary: "table skeleton slot",
          parity_guard: "visual diff against reference.png",
          project_specific_reason: "not applicable",
        },
      ],
      baseline_replacement_plan: [
        {
          boundary_id: "replace-market-table",
          source_region: "table skeleton slot",
          action: "replace_generated_baseline",
          component_family_id: "comp-table",
          replacement_strategy: "mature_library",
          reuse_source: "@tanstack/react-table",
          mature_library_candidates: ["@tanstack/react-table"],
          deletion_rule: "Remove generated table DOM after parity passes.",
          source_refs: ["web-clone-source/source-ir/content-model.json"],
          parity_guard: "visual diff and source audit",
          project_specific_reason: "not applicable",
        },
      ],
      implementation_phase_outcomes: implementationPhaseOutcomes,
      material_inventory_items: [
        {
          title: "Reference",
          detail: "Use reference.png as pixel truth.",
          source_refs: ["web-clone-source/reference.png"],
        },
      ],
      quality_project_items: [
        {
          title: "Source layout",
          detail:
            "Build src/pages/MarketsPage.tsx from the source skeleton, semantic components, and preserved CSS sidecars.",
          source_refs: ["frontend-design-skeleton/src/App.tsx"],
        },
        {
          title: "Verification",
          detail: "Run visual diff against reference.png and source audit before reporting pass.",
          source_refs: ["web-clone-source/reference.png"],
        },
      ],
      frontend_project: {
        status: "created",
        role: "source_baseline_input",
        project_root: "C:\\tmp\\frontend-design-skeleton",
        source_package: "web-clone-source",
        entrypoints: ["README.md", "src/App.tsx", "src/styles.css"],
        generation_tool: "source-skeleton-react",
        notes: ["editable source skeleton"],
      },
      visual_consistency_items: [
        {
          title: "Desktop",
          detail: "Desktop viewport must match reference.png at the configured threshold.",
          source_refs: ["web-clone-source/reference.png"],
        },
      ],
      visual_validation_evidence: visualValidationEvidence(),
      ui_data_contract_items: [
        {
          title: "Rows",
          detail: "Country rows are local mock records, not duplicated JSX.",
          source_refs: ["web-clone-source/source-ir/content-model.json"],
        },
      ],
      template_iteration_notes: ["checked compact handoff", "checked downstream implementation handoff"],
      completeness_review: "complete enough",
    },
    {},
  )

  const final = kit.getCollector().final
  expect(final?.frontend_template).toContain("Route")
  expect(final?.fillable_modules).toContain("Markets table")
  expect(final?.component_inventory).toContain("Component-family cross-check")
  expect(final?.component_inventory).toContain("comp-table")
  expect(final?.quality_project_contract).toContain("Source layout")
  expect(final?.quality_project_contract).toContain("source skeleton")
  expect(final?.frontend_project.role).toBe("source_baseline_input")
  expect(final?.material_inventory).toContain("Reference")
  expect(final?.visual_consistency_contract).toContain("Desktop")
  expect(final?.ui_data_contract).toContain("Rows")

  const report = buildFrontendTemplateReport(kit.getCollector()).detail
  expect(report).toContain("## Implementation Problems And Agent Handoff")
  expect(report).toContain("## Reuse Constraints")
  expect(report).not.toContain("## Component Inventory")
  expect(report).toContain("- acceptance_root: .")
  expect(report).toContain("frontend-design-skeleton is captured source evidence only")
  expect(report).toContain("restore a separate static HTML/CSS visual skeleton")
  expect(report).toContain("maintainable_status: incomplete_source_baseline")
  expect(report).toContain("unfinished frontend_design work")
})

test("submit_frontend_template renders visual HTML skeleton as non-implementation baseline", async () => {
  const fixture = await createVisualEvidenceFixture()
  const kit = createFrontendTemplateOutputTools({ artifactRoot: fixture.artifactRoot })
  const submit = kit.tools.submit_frontend_template as any

  await submit.execute(
    {
      design_system: "source-derived static visual baseline",
      tech_stack: ["static HTML", "CSS", "Playwright visual diff"],
      final_acceptance_mode: "visual_baseline_allowed",
      frontend_template_sections: [
        {
          title: "Visual skeleton route",
          detail: "Render the captured page as a static HTML/CSS skeleton for visual parity only.",
          source_refs: ["web-clone-source/source-skeleton/index.html"],
        },
      ],
      fillable_module_items: [
        {
          title: "Skeleton assets",
          detail: "Use source-owned CSS and assets copied from the task-runtime source package.",
          source_refs: ["web-clone-source/assets", "web-clone-source/source-skeleton/critical.css"],
        },
      ],
      component_reuse_plan: [
        {
          family_id: "comp-static-skeleton",
          name: "Static visual skeleton",
          observed_surface: "Full captured page first viewport",
          source_refs: ["web-clone-source/reference.png", "web-clone-source/source-ir/style-profile.json"],
          implementation_strategy: "extracted_baseline_defer",
          reuse_source: "visual-html-skeleton/index.html",
          mature_library_candidates: [],
          props_states: "static representative visual states only",
          replacement_boundary: "visual skeleton root",
          parity_guard: "Compare skeleton screenshot against source reference.png before transcription.",
          project_specific_reason: "not applicable",
        },
      ],
      material_inventory_items: [
        {
          title: "Source authority",
          detail: "The skeleton is derived from source IR, source skeleton CSS, assets, and the reference screenshot.",
          source_refs: [
            "web-clone-source/source-ir/style-profile.json",
            "web-clone-source/source-skeleton/critical.css",
          ],
        },
      ],
      frontend_project: {
        status: "created",
        role: "visual_baseline_input",
        project_root: "visual-html-skeleton",
        source_package: "web-clone-source",
        entrypoints: [
          "visual-html-skeleton/index.html",
          "visual-html-skeleton/styles.css",
          "visual-html-skeleton/screenshots/desktop.png",
          "visual-html-skeleton/visual-diff.json",
        ],
        generation_tool: "source-ir-static-html-skeleton",
        notes: [
          "Derived from source IR and source skeleton; not a final app.",
          "Rendered screenshot review evidence recorded for visual-html-skeleton/screenshots/desktop.png.",
          "Future project work transcribes this visual skeleton into semantic source.",
        ],
      },
      visual_consistency_items: [
        {
          title: "Reference parity",
          detail: "Skeleton screenshots must be compared against source reference.png.",
          source_refs: ["web-clone-source/reference.png"],
        },
      ],
      visual_validation_evidence: fixture.evidence,
      ui_data_contract_items: [
        {
          title: "Static content",
          detail: "Use visible content from source-ir/content-model.json; no runtime API required for the skeleton.",
          source_refs: ["web-clone-source/source-ir/content-model.json"],
        },
      ],
      template_iteration_notes: ["checked visual skeleton source authority and transcription boundary", "checked downstream implementation handoff"],
      completeness_review:
        "Visual HTML skeleton is complete enough as a source-derived baseline, not as maintainable completion.",
      reference_artifacts: ["web-clone-source/reference.png", "visual-html-skeleton/index.html"],
      open_questions: [],
    },
    {},
  )

  const report = buildFrontendTemplateReport(kit.getCollector()).detail
  expect(report).toContain("- role: visual_baseline_input")
  expect(report).toContain("- acceptance_root: .")
  expect(report).toContain("not an implementation target")
  expect(report).toContain("not the acceptance app root")
  expect(report).toContain("original `web-clone-source/source-ir/*`")
  expect(report).toContain("`web-clone-source/reference.png` remain authoritative")
  expect(report).toContain("Current workflow deliverable")
  expect(report).toContain("Requirements, Architect, Build, and Integrity")
  expect(report).toContain("transcribe the accepted HTML skeleton")
  expect(report).toContain("visual_quality_status: visual_evidence_reported")
  expect(report).not.toContain("maintainable_status: incomplete_source_baseline")
})

test("submit_frontend_template rejects visual skeletons that demote source content sections into navigation labels", async () => {
  const fixture = await createVisualEvidenceFixture()
  await writeSourceStructureContentModel(fixture.artifactRoot)
  const evidence = await writeVisualSkeletonHtmlAndEvidence({
    artifactRoot: fixture.artifactRoot,
    html: [
      "<!doctype html>",
      '<meta charset="utf-8">',
      "<nav><a>Economic trends</a><a>Countries</a><a>Ideas</a></nav>",
      "<main>",
      "  <section><h2>Market overview</h2><p>Inflation growth markets table snapshot</p></section>",
      "</main>",
    ].join("\n"),
  })
  const kit = createFrontendTemplateOutputTools({ artifactRoot: fixture.artifactRoot })
  const submit = kit.tools.submit_frontend_template as any

  await expect(submit.execute(visualBaselinePayload({ ...fixture, evidence }), {})).rejects.toThrow(
    "failed source structure coverage",
  )
  expect(kit.getCollector().final).toBeUndefined()
})

test("submit_frontend_template accepts visual skeletons that preserve source content section order and coverage", async () => {
  const fixture = await createVisualEvidenceFixture()
  await writeSourceStructureContentModel(fixture.artifactRoot)
  const evidence = await writeVisualSkeletonHtmlAndEvidence({
    artifactRoot: fixture.artifactRoot,
    html: [
      "<!doctype html>",
      '<meta charset="utf-8">',
      "<main>",
      '  <section data-oc-region="economic-trends"><h2>Economic trends</h2><p>Inflation map GDP growth India Indonesia rates currencies bonds</p></section>',
      '  <section data-oc-region="countries"><h2>Countries</h2><p>Argentina Australia Brazil Canada China France Germany India</p></section>',
      '  <section data-oc-region="ideas"><h2>Ideas</h2><p>Popular Recent Video Different semiconductor cycle inflation markets</p></section>',
      "</main>",
    ].join("\n"),
  })
  const kit = createFrontendTemplateOutputTools({ artifactRoot: fixture.artifactRoot })
  const submit = kit.tools.submit_frontend_template as any

  await submit.execute(visualBaselinePayload({ ...fixture, evidence }), {})

  expect(kit.getCollector().final?.frontend_project.role).toBe("visual_baseline_input")
})

test("submit_frontend_template rejects text files masquerading as visual baseline screenshots", async () => {
  const fakeScreenshot = Buffer.from("rendered visual skeleton screenshot", "utf8")
  const fixture = await createVisualEvidenceFixture({ screenshot_sha256: sha256(fakeScreenshot) })
  await fs.writeFile(
    path.join(fixture.artifactRoot, "visual-html-skeleton", "screenshots", "desktop.png"),
    fakeScreenshot,
  )
  const kit = createFrontendTemplateOutputTools({ artifactRoot: fixture.artifactRoot })
  const submit = kit.tools.submit_frontend_template as any

  await expect(
    submit.execute(
      {
        design_system: "source-derived static visual baseline",
        tech_stack: ["static HTML", "CSS"],
        final_acceptance_mode: "visual_baseline_allowed",
        frontend_template: "Render the captured page as a static HTML/CSS skeleton for visual parity only.",
        fillable_modules: "Static visual skeleton regions.",
        component_inventory: "Static visual skeleton regions.",
        component_reuse_plan: [
          {
            family_id: "comp-static-skeleton",
            name: "Static visual skeleton",
            observed_surface: "Full captured page first viewport",
            source_refs: ["web-clone-source/reference.png"],
            implementation_strategy: "extracted_baseline_defer",
            reuse_source: "visual-html-skeleton/index.html",
            mature_library_candidates: [],
            props_states: "static representative visual states only",
            replacement_boundary: "visual skeleton root",
            parity_guard: "Compare skeleton screenshot against source reference.png before transcription.",
            project_specific_reason: "not applicable",
          },
        ],
        material_inventory: "source IR, CSS, assets, and reference pixels.",
        material_inventory_items: materialInventoryItems,
        visual_consistency_contract: "Skeleton screenshots must be compared against source reference.png.",
        visual_validation_evidence: fixture.evidence,
        ui_data_contract: "Static visible source content only.",
        frontend_project: {
          status: "created",
          role: "visual_baseline_input",
          project_root: "visual-html-skeleton",
          source_package: "web-clone-source",
          entrypoints: [
            "visual-html-skeleton/index.html",
            "visual-html-skeleton/styles/tokens.css",
            "visual-html-skeleton/screenshots/desktop.png",
          ],
          generation_tool: "source-ir-static-html-skeleton",
          notes: ["Derived from source IR and source skeleton; not a final app."],
        },
        template_iteration_notes: ["checked visual skeleton source authority", "checked downstream implementation handoff"],
        completeness_review: "Rendered screenshot review evidence was recorded.",
        reference_artifacts: ["web-clone-source/reference.png", "visual-html-skeleton/index.html"],
        open_questions: [],
      },
      {},
    ),
  ).rejects.toThrow("requires artifact-backed rendered screenshot review evidence")

  expect(kit.getCollector().final).toBeUndefined()
})

test("submit_frontend_template rejects forged image headers as visual baseline screenshots", async () => {
  const fakeScreenshot = forgedPngHeader()
  const fixture = await createVisualEvidenceFixture({ screenshot_sha256: sha256(fakeScreenshot) })
  await fs.writeFile(
    path.join(fixture.artifactRoot, "visual-html-skeleton", "screenshots", "desktop.png"),
    fakeScreenshot,
  )
  const kit = createFrontendTemplateOutputTools({ artifactRoot: fixture.artifactRoot })
  const submit = kit.tools.submit_frontend_template as any

  await expect(
    submit.execute(
      {
        design_system: "source-derived static visual baseline",
        tech_stack: ["static HTML", "CSS"],
        final_acceptance_mode: "visual_baseline_allowed",
        frontend_template: "Render the captured page as a static HTML/CSS skeleton for visual parity only.",
        fillable_modules: "Static visual skeleton regions.",
        component_inventory: "Static visual skeleton regions.",
        component_reuse_plan: [
          {
            family_id: "comp-static-skeleton",
            name: "Static visual skeleton",
            observed_surface: "Full captured page first viewport",
            source_refs: ["web-clone-source/reference.png"],
            implementation_strategy: "extracted_baseline_defer",
            reuse_source: "visual-html-skeleton/index.html",
            mature_library_candidates: [],
            props_states: "static representative visual states only",
            replacement_boundary: "visual skeleton root",
            parity_guard: "Compare skeleton screenshot against source reference.png before transcription.",
            project_specific_reason: "not applicable",
          },
        ],
        material_inventory: "source IR, CSS, assets, and reference pixels.",
        material_inventory_items: materialInventoryItems,
        visual_consistency_contract: "Skeleton screenshots must be compared against source reference.png.",
        visual_validation_evidence: fixture.evidence,
        ui_data_contract: "Static visible source content only.",
        frontend_project: {
          status: "created",
          role: "visual_baseline_input",
          project_root: "visual-html-skeleton",
          source_package: "web-clone-source",
          entrypoints: [
            "visual-html-skeleton/index.html",
            "visual-html-skeleton/styles/tokens.css",
            "visual-html-skeleton/screenshots/desktop.png",
          ],
          generation_tool: "source-ir-static-html-skeleton",
          notes: ["Derived from source IR and source skeleton; not a final app."],
        },
        template_iteration_notes: ["checked visual skeleton source authority", "checked downstream implementation handoff"],
        completeness_review: "Rendered screenshot review evidence was recorded.",
        reference_artifacts: ["web-clone-source/reference.png", "visual-html-skeleton/index.html"],
        open_questions: [],
      },
      {},
    ),
  ).rejects.toThrow("requires artifact-backed rendered screenshot review evidence")

  expect(kit.getCollector().final).toBeUndefined()
})

test("submit_frontend_template rejects valid screenshots not rendered from the current entrypoint", async () => {
  const fixture = await createVisualEvidenceFixture()
  await fs.writeFile(
    path.join(fixture.artifactRoot, "visual-html-skeleton", "index.html"),
    [
      "<!doctype html>",
      '<meta charset="utf-8">',
      "<style>",
      "html, body { margin: 0; width: 100%; height: 100%; background: rgb(45, 16, 18); }",
      "main { width: 100vw; height: 100vh; background: rgb(45, 16, 18); }",
      "</style>",
      "<main></main>",
    ].join("\n"),
  )
  const kit = createFrontendTemplateOutputTools({ artifactRoot: fixture.artifactRoot })
  const submit = kit.tools.submit_frontend_template as any

  await expect(
    submit.execute(
      {
        design_system: "source-derived static visual baseline",
        tech_stack: ["static HTML", "CSS"],
        final_acceptance_mode: "visual_baseline_allowed",
        frontend_template: "Render the captured page as a static HTML/CSS skeleton for visual parity only.",
        fillable_modules: "Static visual skeleton regions.",
        component_inventory: "Static visual skeleton regions.",
        component_reuse_plan: [
          {
            family_id: "comp-static-skeleton",
            name: "Static visual skeleton",
            observed_surface: "Full captured page first viewport",
            source_refs: ["web-clone-source/reference.png"],
            implementation_strategy: "extracted_baseline_defer",
            reuse_source: "visual-html-skeleton/index.html",
            mature_library_candidates: [],
            props_states: "static representative visual states only",
            replacement_boundary: "visual skeleton root",
            parity_guard: "Compare skeleton screenshot against source reference.png before transcription.",
            project_specific_reason: "not applicable",
          },
        ],
        material_inventory: "source IR, CSS, assets, and reference pixels.",
        material_inventory_items: materialInventoryItems,
        visual_consistency_contract: "Skeleton screenshots must be compared against source reference.png.",
        visual_validation_evidence: fixture.evidence,
        ui_data_contract: "Static visible source content only.",
        frontend_project: {
          status: "created",
          role: "visual_baseline_input",
          project_root: "visual-html-skeleton",
          source_package: "web-clone-source",
          entrypoints: [
            "visual-html-skeleton/index.html",
            "visual-html-skeleton/styles/tokens.css",
            "visual-html-skeleton/screenshots/desktop.png",
          ],
          generation_tool: "source-ir-static-html-skeleton",
          notes: ["Derived from source IR and source skeleton; not a final app."],
        },
        template_iteration_notes: ["checked stale rendered screenshot", "checked downstream implementation handoff"],
        completeness_review: "Rendered screenshot evidence was stale relative to the current entrypoint.",
        reference_artifacts: ["web-clone-source/reference.png", "visual-html-skeleton/index.html"],
        open_questions: [],
      },
      {},
    ),
  ).rejects.toThrow("requires artifact-backed rendered screenshot review evidence")

  expect(kit.getCollector().final).toBeUndefined()
})

test("submit_frontend_template rejects visual baseline without rendered screenshot evidence", async () => {
  const kit = createFrontendTemplateOutputTools()
  const submit = kit.tools.submit_frontend_template as any

  await expect(
    submit.execute(
      {
        design_system: "source-derived static visual baseline",
        tech_stack: ["static HTML", "CSS"],
        final_acceptance_mode: "visual_baseline_allowed",
        frontend_template: "Render the captured page as a static HTML/CSS skeleton for visual parity only.",
        fillable_modules: "Static visual skeleton regions.",
        component_inventory: "Static visual skeleton regions.",
        component_reuse_plan: [
          {
            family_id: "comp-static-skeleton",
            name: "Static visual skeleton",
            observed_surface: "Full captured page first viewport",
            source_refs: ["web-clone-source/reference.png"],
            implementation_strategy: "extracted_baseline_defer",
            reuse_source: "visual-html-skeleton/index.html",
            mature_library_candidates: [],
            props_states: "static representative visual states only",
            replacement_boundary: "visual skeleton root",
            parity_guard: "Compare skeleton screenshot against source reference.png before transcription.",
            project_specific_reason: "not applicable",
          },
        ],
        material_inventory: "source IR, CSS, assets, and reference pixels.",
        material_inventory_items: materialInventoryItems,
        visual_consistency_contract: "Skeleton screenshots must be compared against source reference.png.",
        ui_data_contract: "Static visible source content only.",
        frontend_project: {
          status: "created",
          role: "visual_baseline_input",
          project_root: "visual-html-skeleton",
          source_package: "web-clone-source",
          entrypoints: ["visual-html-skeleton/index.html", "visual-html-skeleton/styles/tokens.css"],
          generation_tool: "source-ir-static-html-skeleton",
          notes: ["Derived from source IR and source skeleton; not a final app."],
        },
        template_iteration_notes: ["checked visual skeleton source authority", "checked downstream implementation handoff"],
        completeness_review: "No rendered screenshot review evidence was recorded.",
        reference_artifacts: ["web-clone-source/reference.png", "visual-html-skeleton/index.html"],
        open_questions: [],
      },
      {},
    ),
  ).rejects.toThrow("requires artifact-backed rendered screenshot review evidence")

  expect(kit.getCollector().final).toBeUndefined()
})

test("submit_frontend_template rejects reference screenshot paths as visual baseline render evidence", async () => {
  const kit = createFrontendTemplateOutputTools()
  const submit = kit.tools.submit_frontend_template as any

  await expect(
    submit.execute(
      {
        design_system: "source-derived static visual baseline",
        tech_stack: ["static HTML", "CSS"],
        final_acceptance_mode: "visual_baseline_allowed",
        frontend_template: "Render the captured page as a static HTML/CSS skeleton for visual parity only.",
        fillable_modules: "Static visual skeleton regions.",
        component_inventory: "Static visual skeleton regions.",
        component_reuse_plan: [
          {
            family_id: "comp-static-skeleton",
            name: "Static visual skeleton",
            observed_surface: "Full captured page first viewport",
            source_refs: ["web-clone-source/reference.png"],
            implementation_strategy: "extracted_baseline_defer",
            reuse_source: "visual-html-skeleton/index.html",
            mature_library_candidates: [],
            props_states: "static representative visual states only",
            replacement_boundary: "visual skeleton root",
            parity_guard: "Compare skeleton screenshot against source reference.png before transcription.",
            project_specific_reason: "not applicable",
          },
        ],
        material_inventory: "source IR, CSS, assets, and reference pixels.",
        material_inventory_items: materialInventoryItems,
        visual_consistency_contract:
          "Reference screenshot artifact path web-clone-source/reference.png was reviewed as the visual source.",
        ui_data_contract: "Static visible source content only.",
        frontend_project: {
          status: "created",
          role: "visual_baseline_input",
          project_root: "visual-html-skeleton",
          source_package: "web-clone-source",
          entrypoints: ["visual-html-skeleton/index.html", "visual-html-skeleton/styles/tokens.css"],
          generation_tool: "source-ir-static-html-skeleton",
          notes: ["Derived from source IR and source skeleton; not a final app."],
        },
        template_iteration_notes: ["checked source reference screenshot", "checked downstream implementation handoff"],
        completeness_review: "Screenshot artifact path web-clone-source/reference.png was recorded.",
        reference_artifacts: ["web-clone-source/reference.png"],
        open_questions: [],
      },
      {},
    ),
  ).rejects.toThrow("requires artifact-backed rendered screenshot review evidence")

  expect(kit.getCollector().final).toBeUndefined()
})

test("submit_frontend_template rejects copied reference screenshots under visual skeleton as render evidence", async () => {
  const kit = createFrontendTemplateOutputTools()
  const submit = kit.tools.submit_frontend_template as any

  await expect(
    submit.execute(
      {
        design_system: "source-derived static visual baseline",
        tech_stack: ["static HTML", "CSS"],
        final_acceptance_mode: "visual_baseline_allowed",
        frontend_template: "Render the captured page as a static HTML/CSS skeleton for visual parity only.",
        fillable_modules: "Static visual skeleton regions.",
        component_inventory: "Static visual skeleton regions.",
        component_reuse_plan: [
          {
            family_id: "comp-static-skeleton",
            name: "Static visual skeleton",
            observed_surface: "Full captured page first viewport",
            source_refs: ["web-clone-source/reference.png"],
            implementation_strategy: "extracted_baseline_defer",
            reuse_source: "visual-html-skeleton/index.html",
            mature_library_candidates: [],
            props_states: "static representative visual states only",
            replacement_boundary: "visual skeleton root",
            parity_guard: "Rendered screenshot review evidence recorded for visual-html-skeleton/reference.png.",
            project_specific_reason: "not applicable",
          },
        ],
        material_inventory: "source IR, CSS, assets, and reference pixels.",
        material_inventory_items: materialInventoryItems,
        visual_consistency_contract:
          "Rendered screenshot review evidence recorded for visual-html-skeleton/reference.png.",
        ui_data_contract: "Static visible source content only.",
        frontend_project: {
          status: "created",
          role: "visual_baseline_input",
          project_root: "visual-html-skeleton",
          source_package: "web-clone-source",
          entrypoints: ["visual-html-skeleton/index.html", "visual-html-skeleton/reference.png"],
          generation_tool: "source-ir-static-html-skeleton",
          notes: ["Rendered screenshot review evidence recorded for visual-html-skeleton/reference.png."],
        },
        template_iteration_notes: ["checked copied reference screenshot", "checked downstream implementation handoff"],
        completeness_review: "Rendered screenshot artifact path visual-html-skeleton/reference.png was recorded.",
        reference_artifacts: ["visual-html-skeleton/reference.png"],
        open_questions: [],
      },
      {},
    ),
  ).rejects.toThrow("requires artifact-backed rendered screenshot review evidence")

  expect(kit.getCollector().final).toBeUndefined()
})

test("submit_frontend_template rejects renamed copied reference screenshots by digest", async () => {
  const kit = createFrontendTemplateOutputTools()
  const submit = kit.tools.submit_frontend_template as any

  await expect(
    submit.execute(
      {
        design_system: "source-derived static visual baseline",
        tech_stack: ["static HTML", "CSS"],
        final_acceptance_mode: "visual_baseline_allowed",
        frontend_template: "Render the captured page as a static HTML/CSS skeleton for visual parity only.",
        fillable_modules: "Static visual skeleton regions.",
        component_inventory: "Static visual skeleton regions.",
        component_reuse_plan: [
          {
            family_id: "comp-static-skeleton",
            name: "Static visual skeleton",
            observed_surface: "Full captured page first viewport",
            source_refs: ["web-clone-source/reference.png"],
            implementation_strategy: "extracted_baseline_defer",
            reuse_source: "visual-html-skeleton/index.html",
            mature_library_candidates: [],
            props_states: "static representative visual states only",
            replacement_boundary: "visual skeleton root",
            parity_guard:
              "Rendered screenshot review evidence recorded for visual-html-skeleton/screenshots/desktop.png.",
            project_specific_reason: "not applicable",
          },
        ],
        material_inventory: "source IR, CSS, assets, and reference pixels.",
        material_inventory_items: materialInventoryItems,
        visual_consistency_contract:
          "Rendered screenshot review evidence recorded for visual-html-skeleton/screenshots/desktop.png.",
        visual_validation_evidence: visualValidationEvidence({
          screenshot_artifact: "visual-html-skeleton/screenshots/desktop.png",
          source_reference_artifact: "web-clone-source/reference.png",
          screenshot_sha256: sourceReferenceSha,
          source_reference_sha256: sourceReferenceSha,
          review_summary: "The copied source reference was renamed into the screenshot directory.",
        }),
        ui_data_contract: "Static visible source content only.",
        frontend_project: {
          status: "created",
          role: "visual_baseline_input",
          project_root: "visual-html-skeleton",
          source_package: "web-clone-source",
          entrypoints: ["visual-html-skeleton/index.html", "visual-html-skeleton/screenshots/desktop.png"],
          generation_tool: "source-ir-static-html-skeleton",
          notes: ["Rendered screenshot review evidence recorded for visual-html-skeleton/screenshots/desktop.png."],
        },
        template_iteration_notes: ["checked renamed reference screenshot", "checked downstream implementation handoff"],
        completeness_review:
          "Rendered screenshot artifact path visual-html-skeleton/screenshots/desktop.png was recorded.",
        reference_artifacts: ["visual-html-skeleton/screenshots/desktop.png"],
        open_questions: [],
      },
      {},
    ),
  ).rejects.toThrow("requires artifact-backed rendered screenshot review evidence")

  expect(kit.getCollector().final).toBeUndefined()
})

test("submit_frontend_template rejects maintainable mode downgraded to visual baseline role", async () => {
  const kit = createFrontendTemplateOutputTools()
  const submit = kit.tools.submit_frontend_template as any

  await expect(
    submit.execute(
      {
        design_system: "AInvest component system",
        tech_stack: ["React", "AInvest UI"],
        final_acceptance_mode: "maintainable_replacement_required",
        frontend_template: "Production-mergeable page using real AInvest components.",
        fillable_modules: "Implementation modules.",
        component_inventory: "AInvest components.",
        component_reuse_plan: [
          {
            family_id: "comp-table",
            name: "AInvest table",
            observed_surface: "Main data table",
            source_refs: ["web-clone-source/reference.png"],
            implementation_strategy: "existing_project_component",
            reuse_source: "@ainvest/table",
            mature_library_candidates: [],
            props_states: "rows, columns, hover",
            replacement_boundary: "table region",
            parity_guard:
              "Rendered screenshot review evidence recorded for visual-html-skeleton/screenshots/desktop.png.",
            project_specific_reason: "not applicable",
          },
        ],
        material_inventory: "AInvest tokens and source data.",
        material_inventory_items: materialInventoryItems,
        visual_consistency_contract:
          "Rendered screenshot review evidence recorded for visual-html-skeleton/screenshots/desktop.png.",
        ui_data_contract: "Static fixture data.",
        frontend_project: {
          status: "created",
          role: "visual_baseline_input",
          project_root: "visual-html-skeleton",
          source_package: "web-clone-source",
          entrypoints: ["visual-html-skeleton/index.html", "visual-html-skeleton/screenshots/desktop.png"],
          generation_tool: "source-ir-static-html-skeleton",
          notes: ["Rendered screenshot review evidence recorded for visual-html-skeleton/screenshots/desktop.png."],
        },
        template_iteration_notes: ["checked visual skeleton", "checked downstream implementation handoff"],
        completeness_review: "Production implementation is still missing.",
        reference_artifacts: ["visual-html-skeleton/screenshots/desktop.png"],
        open_questions: [],
      },
      {},
    ),
  ).rejects.toThrow("maintainable_replacement_required cannot submit frontend_project.role=visual_baseline_input")

  expect(kit.getCollector().final).toBeUndefined()
})

test("submit_frontend_template rejects maintainable mode without structured implementation phase outcomes", async () => {
  const kit = createFrontendTemplateOutputTools()
  const submit = kit.tools.submit_frontend_template as any

  const payload = maintainableImplementationPayload({ implementation_phase_outcomes: [] })

  await expect(submit.execute(payload, {})).rejects.toThrow(
    "maintainable_replacement_required requires structured implementation_phase_outcomes",
  )
  expect(kit.getCollector().final).toBeUndefined()
})

test("submit_frontend_template rejects implementation target with missing real entrypoint", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "frontend-missing-entrypoint-"))
  const projectRoot = "app"
  await fs.mkdir(path.join(workspaceRoot, projectRoot), { recursive: true })
  await fs.writeFile(path.join(workspaceRoot, projectRoot, "package.json"), JSON.stringify({ dependencies: {} }))
  const kit = createFrontendTemplateOutputTools({ workspaceRoot })
  const submit = kit.tools.submit_frontend_template as any

  await expect(
    submit.execute(
      maintainableImplementationPayload({
        frontend_project: {
          status: "created",
          role: "implementation_target",
          project_root: projectRoot,
          source_package: "web-clone-source",
          entrypoints: ["src/main.tsx"],
          generation_tool: "existing-project",
          notes: ["implementation scaffold inspected"],
        },
      }),
      {},
    ),
  ).rejects.toThrow("requires every entrypoint to be a real project-root-relative file")
  expect(kit.getCollector().final).toBeUndefined()
})

test("submit_frontend_template rejects implementation target claiming an uninstalled mature library", async () => {
  const fixture = await createImplementationProjectFixture({})
  const kit = createFrontendTemplateOutputTools({ workspaceRoot: fixture.workspaceRoot })
  const submit = kit.tools.submit_frontend_template as any

  await expect(
    submit.execute(
      maintainableImplementationPayload({
        component_reuse_plan: [
          {
            family_id: "comp-map",
            name: "Industrial map",
            observed_surface: "Interactive map",
            source_refs: ["web-clone-source/reference.png"],
            implementation_strategy: "mature_library",
            reuse_source: "echarts",
            mature_library_candidates: ["echarts"],
            props_states: "regions, tooltip, hover state",
            replacement_boundary: "map region",
            parity_guard: "visual diff and keyboard tooltip check",
            project_specific_reason: "not applicable",
          },
        ],
        frontend_project: {
          status: "created",
          role: "implementation_target",
          project_root: fixture.projectRoot,
          source_package: "web-clone-source",
          entrypoints: ["src/main.tsx"],
          generation_tool: "existing-project",
          notes: ["implementation scaffold inspected"],
        },
      }),
      {},
    ),
  ).rejects.toThrow("reuse sources must bind to an installed package")
  expect(kit.getCollector().final).toBeUndefined()
})

test("submit_frontend_template accepts implementation target with installed mature library and real entrypoint", async () => {
  const fixture = await createImplementationProjectFixture({ echarts: "^5.5.0" })
  const kit = createFrontendTemplateOutputTools({ workspaceRoot: fixture.workspaceRoot })
  const submit = kit.tools.submit_frontend_template as any

  const out = await submit.execute(
    maintainableImplementationPayload({
      component_reuse_plan: [
        {
          family_id: "comp-map",
          name: "Industrial map",
          observed_surface: "Interactive map",
          source_refs: ["web-clone-source/reference.png"],
          implementation_strategy: "mature_library",
          reuse_source: "echarts",
          mature_library_candidates: ["echarts"],
          props_states: "regions, tooltip, hover state",
          replacement_boundary: "map region",
          parity_guard: "visual diff and keyboard tooltip check",
          project_specific_reason: "not applicable",
        },
      ],
      frontend_project: {
        status: "created",
        role: "implementation_target",
        project_root: fixture.projectRoot,
        source_package: "web-clone-source",
        entrypoints: ["src/main.tsx"],
        generation_tool: "existing-project",
        notes: ["implementation scaffold inspected"],
      },
    }),
    {},
  )

  expect(out).toContain("OK")
  expect(kit.getCollector().final?.frontend_project.role).toBe("implementation_target")
})

test("submit_frontend_template accepts implementation target rooted at the workspace", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "frontend-workspace-root-target-"))
  await fs.mkdir(path.join(workspaceRoot, "src"), { recursive: true })
  await fs.writeFile(path.join(workspaceRoot, "package.json"), JSON.stringify({ dependencies: { echarts: "^5.5.0" } }))
  await fs.writeFile(path.join(workspaceRoot, "src", "main.tsx"), "export const app = true\n")
  const kit = createFrontendTemplateOutputTools({ workspaceRoot })
  const submit = kit.tools.submit_frontend_template as any

  const out = await submit.execute(
    maintainableImplementationPayload({
      component_reuse_plan: [
        {
          family_id: "comp-map",
          name: "Industrial map",
          observed_surface: "Interactive map",
          source_refs: ["web-clone-source/reference.png"],
          implementation_strategy: "mature_library",
          reuse_source: "echarts",
          mature_library_candidates: ["echarts"],
          props_states: "regions, tooltip, hover state",
          replacement_boundary: "map region",
          parity_guard: "visual diff and keyboard tooltip check",
          project_specific_reason: "not applicable",
        },
      ],
      frontend_project: {
        status: "created",
        role: "implementation_target",
        project_root: ".",
        source_package: "web-clone-source",
        entrypoints: ["src/main.tsx"],
        generation_tool: "existing-project",
        notes: ["implementation scaffold inspected at workspace root"],
      },
    }),
    {},
  )

  expect(out).toContain("OK")
  expect(kit.getCollector().final?.frontend_project.project_root).toBe(".")
})

test("submit_frontend_template rejects visual HTML skeleton masquerading as implementation target", async () => {
  const kit = createFrontendTemplateOutputTools()
  const submit = kit.tools.submit_frontend_template as any

  await expect(
    submit.execute(
      {
        design_system: "AInvest component system",
        tech_stack: ["React", "AInvest UI"],
        final_acceptance_mode: "maintainable_replacement_required",
        frontend_template: "Production-mergeable page using real AInvest components.",
        fillable_modules: "Implementation modules.",
        component_inventory: "AInvest components.",
        component_reuse_plan: [
          {
            family_id: "comp-table",
            name: "AInvest table",
            observed_surface: "Main data table",
            source_refs: ["web-clone-source/reference.png"],
            implementation_strategy: "existing_project_component",
            reuse_source: "@ainvest/table",
            mature_library_candidates: [],
            props_states: "rows, columns, hover",
            replacement_boundary: "table region",
            parity_guard:
              "Rendered screenshot review evidence recorded for visual-html-skeleton/screenshots/desktop.png.",
            project_specific_reason: "not applicable",
          },
        ],
        material_inventory: "AInvest tokens and source data.",
        material_inventory_items: materialInventoryItems,
        visual_consistency_contract:
          "Blocking visual debt: placeholder table and map remain in visual-html-skeleton/screenshots/desktop.png.",
        ui_data_contract: "Static fixture data.",
        frontend_project: {
          status: "created",
          role: "implementation_target",
          project_root: "visual-html-skeleton",
          source_package: "web-clone-source",
          entrypoints: ["visual-html-skeleton/index.html", "visual-html-skeleton/screenshots/desktop.png"],
          generation_tool: "source-ir-static-html-skeleton",
          notes: ["Blocking visual debt: placeholders remain."],
        },
        template_iteration_notes: ["checked production target", "checked downstream implementation handoff"],
        completeness_review: "Blocking visual debt remains, but the skeleton was incorrectly named as implementation.",
        reference_artifacts: ["visual-html-skeleton/screenshots/desktop.png"],
        open_questions: [],
      },
      {},
    ),
  ).rejects.toThrow("implementation_target cannot point at visual-html-skeleton")

  expect(kit.getCollector().final).toBeUndefined()
})

test("submit_frontend_template rejects aliased visual HTML skeleton implementation target roots", async () => {
  const kit = createFrontendTemplateOutputTools()
  const submit = kit.tools.submit_frontend_template as any

  await expect(
    submit.execute(
      {
        design_system: "AInvest component system",
        tech_stack: ["React", "AInvest UI"],
        final_acceptance_mode: "maintainable_replacement_required",
        frontend_template: "Production-mergeable page using real AInvest components.",
        fillable_modules: "Implementation modules.",
        component_inventory: "AInvest components.",
        component_reuse_plan: [
          {
            family_id: "comp-table",
            name: "AInvest table",
            observed_surface: "Main data table",
            source_refs: ["web-clone-source/reference.png"],
            implementation_strategy: "existing_project_component",
            reuse_source: "@ainvest/table",
            mature_library_candidates: [],
            props_states: "rows, columns, hover",
            replacement_boundary: "table region",
            parity_guard: "visual diff",
            project_specific_reason: "not applicable",
          },
        ],
        material_inventory: "AInvest tokens and source data.",
        material_inventory_items: materialInventoryItems,
        visual_consistency_contract: "Blocking visual debt: placeholders remain.",
        ui_data_contract: "Static fixture data.",
        frontend_project: {
          status: "created",
          role: "implementation_target",
          project_root: "visual-html-skeleton/.",
          source_package: "web-clone-source",
          entrypoints: ["visual-html-skeleton/./index.html"],
          generation_tool: "source-ir-static-html-skeleton",
          notes: ["Blocking visual debt: placeholders remain."],
        },
        template_iteration_notes: ["checked production target", "checked downstream implementation handoff"],
        completeness_review: "Blocking visual debt remains, but the skeleton was incorrectly named as implementation.",
        reference_artifacts: ["visual-html-skeleton/screenshots/desktop.png"],
        open_questions: [],
      },
      {},
    ),
  ).rejects.toThrow("implementation_target cannot point at visual-html-skeleton")

  expect(kit.getCollector().final).toBeUndefined()
})

test("submit_frontend_template rejects case-aliased visual HTML skeleton implementation target roots", async () => {
  const kit = createFrontendTemplateOutputTools()
  const submit = kit.tools.submit_frontend_template as any

  await expect(
    submit.execute(
      {
        design_system: "AInvest component system",
        tech_stack: ["React", "AInvest UI"],
        final_acceptance_mode: "maintainable_replacement_required",
        frontend_template: "Production-mergeable page using real AInvest components.",
        fillable_modules: "Implementation modules.",
        component_inventory: "AInvest components.",
        component_reuse_plan: [
          {
            family_id: "comp-table",
            name: "AInvest table",
            observed_surface: "Main data table",
            source_refs: ["web-clone-source/reference.png"],
            implementation_strategy: "existing_project_component",
            reuse_source: "@ainvest/table",
            mature_library_candidates: [],
            props_states: "rows, columns, hover",
            replacement_boundary: "table region",
            parity_guard: "visual diff",
            project_specific_reason: "not applicable",
          },
        ],
        material_inventory: "AInvest tokens and source data.",
        material_inventory_items: materialInventoryItems,
        visual_consistency_contract: "Blocking visual debt: placeholders remain.",
        ui_data_contract: "Static fixture data.",
        frontend_project: {
          status: "created",
          role: "implementation_target",
          project_root: "Visual-Html-Skeleton",
          source_package: "web-clone-source",
          entrypoints: ["Visual-Html-Skeleton/index.html"],
          generation_tool: "source-ir-static-html-skeleton",
          notes: ["Blocking visual debt: placeholders remain."],
        },
        template_iteration_notes: ["checked production target", "checked downstream implementation handoff"],
        completeness_review: "Windows case aliases must not turn the static visual skeleton into implementation.",
        reference_artifacts: ["visual-html-skeleton/screenshots/desktop.png"],
        open_questions: [],
      },
      {},
    ),
  ).rejects.toThrow("implementation_target cannot point at visual-html-skeleton")

  expect(kit.getCollector().final).toBeUndefined()
})

test("submit_frontend_template rejects visual HTML skeleton subpaths as implementation target roots", async () => {
  for (const projectRoot of [
    "visual-html-skeleton/src",
    ".opencorvus/r/t/TS/KX/fd/visual-html-skeleton/src",
    "visual-html-skeleton.",
    "visual-html-skeleton./src",
    "visual-html-skeleton /src",
    ".opencorvus/r/t/TS/KX/fd/visual-html-skeleton./src",
  ]) {
    const kit = createFrontendTemplateOutputTools()
    const submit = kit.tools.submit_frontend_template as any

    await expect(
      submit.execute(
        {
          design_system: "AInvest component system",
          tech_stack: ["React", "AInvest UI"],
          final_acceptance_mode: "maintainable_replacement_required",
          frontend_template: "Production-mergeable page using real AInvest components.",
          fillable_modules: "Implementation modules.",
          component_inventory: "AInvest components.",
          component_reuse_plan: [
            {
              family_id: "comp-table",
              name: "AInvest table",
              observed_surface: "Main data table",
              source_refs: ["web-clone-source/reference.png"],
              implementation_strategy: "existing_project_component",
              reuse_source: "@ainvest/table",
              mature_library_candidates: [],
              props_states: "rows, columns, hover",
              replacement_boundary: "table region",
              parity_guard: "visual diff",
              project_specific_reason: "not applicable",
            },
          ],
          material_inventory: "AInvest tokens and source data.",
          material_inventory_items: materialInventoryItems,
          visual_consistency_contract: "Blocking visual debt: placeholders remain.",
          ui_data_contract: "Static fixture data.",
          frontend_project: {
            status: "created",
            role: "implementation_target",
            project_root: projectRoot,
            source_package: "web-clone-source",
            entrypoints: [`${projectRoot}/App.tsx`],
            generation_tool: "source-ir-static-html-skeleton",
            notes: ["Blocking visual debt: placeholders remain."],
          },
          template_iteration_notes: ["checked production target", "checked downstream implementation handoff"],
          completeness_review: "Visual skeleton subpaths must not become implementation targets.",
          reference_artifacts: ["visual-html-skeleton/screenshots/desktop.png"],
          open_questions: [],
        },
        {},
      ),
    ).rejects.toThrow("implementation_target cannot point at visual-html-skeleton")

    expect(kit.getCollector().final).toBeUndefined()
  }
})

test("submit_frontend_template rejects self-attested screenshot evidence without artifact files", async () => {
  const kit = createFrontendTemplateOutputTools()
  const submit = kit.tools.submit_frontend_template as any

  await expect(
    submit.execute(
      {
        design_system: "source-derived static visual baseline",
        tech_stack: ["static HTML", "CSS"],
        final_acceptance_mode: "visual_baseline_allowed",
        frontend_template: "Render the captured page as a static HTML/CSS skeleton for visual parity only.",
        fillable_modules: "Static visual skeleton regions.",
        component_inventory: "Static visual skeleton regions.",
        component_reuse_plan: [
          {
            family_id: "comp-static-skeleton",
            name: "Static visual skeleton",
            observed_surface: "Full captured page first viewport",
            source_refs: ["web-clone-source/reference.png"],
            implementation_strategy: "extracted_baseline_defer",
            reuse_source: "visual-html-skeleton/index.html",
            mature_library_candidates: [],
            props_states: "static representative visual states only",
            replacement_boundary: "visual skeleton root",
            parity_guard:
              "Rendered screenshot review evidence recorded for visual-html-skeleton/screenshots/nonexistent-desktop.png.",
            project_specific_reason: "not applicable",
          },
        ],
        material_inventory: "source IR, CSS, assets, and reference pixels.",
        material_inventory_items: materialInventoryItems,
        visual_consistency_contract:
          "Rendered screenshot review evidence recorded for visual-html-skeleton/screenshots/nonexistent-desktop.png.",
        visual_validation_evidence: visualValidationEvidence({
          screenshot_artifact: "visual-html-skeleton/screenshots/nonexistent-desktop.png",
          screenshot_sha256: "a".repeat(64),
          source_reference_sha256: sourceReferenceSha,
          review_summary: "Self-attested screenshot path and arbitrary hashes without real artifact files.",
        }),
        ui_data_contract: "Static visible source content only.",
        frontend_project: {
          status: "created",
          role: "visual_baseline_input",
          project_root: "visual-html-skeleton",
          source_package: "web-clone-source",
          entrypoints: ["visual-html-skeleton/index.html", "visual-html-skeleton/screenshots/nonexistent-desktop.png"],
          generation_tool: "source-ir-static-html-skeleton",
          notes: [
            "Rendered screenshot review evidence recorded for visual-html-skeleton/screenshots/nonexistent-desktop.png.",
          ],
        },
        template_iteration_notes: ["checked self-attested screenshot", "checked downstream implementation handoff"],
        completeness_review:
          "Rendered screenshot artifact path visual-html-skeleton/screenshots/nonexistent-desktop.png was recorded.",
        reference_artifacts: ["visual-html-skeleton/screenshots/nonexistent-desktop.png"],
        open_questions: [],
      },
      {},
    ),
  ).rejects.toThrow("requires artifact-backed rendered screenshot review evidence")

  expect(kit.getCollector().final).toBeUndefined()
})

test("submit_frontend_template rejects traversed visual validation artifacts even when files exist", async () => {
  const fixture = await createVisualEvidenceFixture()
  const traversedEntrypointBytes = Buffer.from("<!doctype html><p>source</p>\n", "utf8")
  const traversedScreenshotBytes = Buffer.from("rendered screenshot outside visual skeleton", "utf8")
  await fs.mkdir(path.join(fixture.artifactRoot, "web-clone-source", "source-skeleton"), { recursive: true })
  await fs.mkdir(path.join(fixture.artifactRoot, "web-clone-source", "renders"), { recursive: true })
  await fs.writeFile(
    path.join(fixture.artifactRoot, "web-clone-source", "source-skeleton", "index.html"),
    traversedEntrypointBytes,
  )
  await fs.writeFile(
    path.join(fixture.artifactRoot, "web-clone-source", "renders", "desktop.png"),
    traversedScreenshotBytes,
  )

  const kit = createFrontendTemplateOutputTools({ artifactRoot: fixture.artifactRoot })
  const submit = kit.tools.submit_frontend_template as any

  await expect(
    submit.execute(
      {
        design_system: "source-derived static visual baseline",
        tech_stack: ["static HTML", "CSS"],
        final_acceptance_mode: "visual_baseline_allowed",
        frontend_template: "Render the captured page as a static HTML/CSS skeleton for visual parity only.",
        fillable_modules: "Static visual skeleton regions.",
        component_inventory: "Static visual skeleton regions.",
        component_reuse_plan: [
          {
            family_id: "comp-static-skeleton",
            name: "Static visual skeleton",
            observed_surface: "Full captured page first viewport",
            source_refs: ["web-clone-source/reference.png"],
            implementation_strategy: "extracted_baseline_defer",
            reuse_source: "visual-html-skeleton/index.html",
            mature_library_candidates: [],
            props_states: "static representative visual states only",
            replacement_boundary: "visual skeleton root",
            parity_guard:
              "Rendered screenshot review evidence recorded for visual-html-skeleton/screenshots/desktop.png.",
            project_specific_reason: "not applicable",
          },
        ],
        material_inventory: "source IR, CSS, assets, and reference pixels.",
        material_inventory_items: materialInventoryItems,
        visual_consistency_contract: "Rendered screenshot review evidence recorded for traversed files.",
        visual_validation_evidence: visualValidationEvidence({
          rendered_entrypoint: "visual-html-skeleton/../web-clone-source/source-skeleton/index.html",
          screenshot_artifact: "visual-html-skeleton/screenshots/../../web-clone-source/renders/desktop.png",
          screenshot_sha256: sha256(traversedScreenshotBytes),
          source_reference_sha256: fixture.evidence[0].source_reference_sha256,
          review_summary: "Traversal points at existing files outside the visual skeleton root.",
        }),
        ui_data_contract: "Static visible source content only.",
        frontend_project: {
          status: "created",
          role: "visual_baseline_input",
          project_root: "visual-html-skeleton",
          source_package: "web-clone-source",
          entrypoints: ["visual-html-skeleton/index.html"],
          generation_tool: "source-ir-static-html-skeleton",
          notes: ["Rendered screenshot review evidence recorded for traversed files."],
        },
        template_iteration_notes: ["checked traversed screenshot", "checked downstream implementation handoff"],
        completeness_review: "Traversal should not satisfy visual skeleton evidence.",
        reference_artifacts: ["web-clone-source/reference.png"],
        open_questions: [],
      },
      {},
    ),
  ).rejects.toThrow("requires artifact-backed rendered screenshot review evidence")

  expect(kit.getCollector().final).toBeUndefined()
})

test("submit_frontend_template rejects traversed visual baseline project roots", async () => {
  const fixture = await createVisualEvidenceFixture()
  const kit = createFrontendTemplateOutputTools({ artifactRoot: fixture.artifactRoot })
  const submit = kit.tools.submit_frontend_template as any

  await expect(
    submit.execute(
      {
        design_system: "source-derived static visual baseline",
        tech_stack: ["static HTML", "CSS"],
        final_acceptance_mode: "visual_baseline_allowed",
        frontend_template: "Render the captured page as a static HTML/CSS skeleton for visual parity only.",
        fillable_modules: "Static visual skeleton regions.",
        component_inventory: "Static visual skeleton regions.",
        component_reuse_plan: [
          {
            family_id: "comp-static-skeleton",
            name: "Static visual skeleton",
            observed_surface: "Full captured page first viewport",
            source_refs: ["web-clone-source/reference.png"],
            implementation_strategy: "extracted_baseline_defer",
            reuse_source: "visual-html-skeleton/index.html",
            mature_library_candidates: [],
            props_states: "static representative visual states only",
            replacement_boundary: "visual skeleton root",
            parity_guard:
              "Rendered screenshot review evidence recorded for visual-html-skeleton/screenshots/desktop.png.",
            project_specific_reason: "not applicable",
          },
        ],
        material_inventory: "source IR, CSS, assets, and reference pixels.",
        material_inventory_items: materialInventoryItems,
        visual_consistency_contract:
          "Rendered screenshot review evidence recorded for visual-html-skeleton/screenshots/desktop.png.",
        visual_validation_evidence: fixture.evidence,
        ui_data_contract: "Static visible source content only.",
        frontend_project: {
          status: "created",
          role: "visual_baseline_input",
          project_root: "visual-html-skeleton/../web-clone-source",
          source_package: "web-clone-source",
          entrypoints: ["visual-html-skeleton/index.html"],
          generation_tool: "source-ir-static-html-skeleton",
          notes: ["Rendered screenshot review evidence recorded for visual-html-skeleton/screenshots/desktop.png."],
        },
        template_iteration_notes: ["checked traversed project root", "checked downstream implementation handoff"],
        completeness_review: "A traversed source package root must not become the visual baseline.",
        reference_artifacts: ["web-clone-source/reference.png"],
        open_questions: [],
      },
      {},
    ),
  ).rejects.toThrow("project_root to point at visual-html-skeleton")

  expect(kit.getCollector().final).toBeUndefined()
})

test("submit_frontend_template rejects parent-traversed visual baseline project roots", async () => {
  const fixture = await createVisualEvidenceFixture()
  const kit = createFrontendTemplateOutputTools({ artifactRoot: fixture.artifactRoot })
  const submit = kit.tools.submit_frontend_template as any

  await expect(
    submit.execute(
      {
        design_system: "source-derived static visual baseline",
        tech_stack: ["static HTML", "CSS"],
        final_acceptance_mode: "visual_baseline_allowed",
        frontend_template: "Render the captured page as a static HTML/CSS skeleton for visual parity only.",
        fillable_modules: "Static visual skeleton regions.",
        component_inventory: "Static visual skeleton regions.",
        component_reuse_plan: [
          {
            family_id: "comp-static-skeleton",
            name: "Static visual skeleton",
            observed_surface: "Full captured page first viewport",
            source_refs: ["web-clone-source/reference.png"],
            implementation_strategy: "extracted_baseline_defer",
            reuse_source: "visual-html-skeleton/index.html",
            mature_library_candidates: [],
            props_states: "static representative visual states only",
            replacement_boundary: "visual skeleton root",
            parity_guard:
              "Rendered screenshot review evidence recorded for visual-html-skeleton/screenshots/desktop.png.",
            project_specific_reason: "not applicable",
          },
        ],
        material_inventory: "source IR, CSS, assets, and reference pixels.",
        material_inventory_items: materialInventoryItems,
        visual_consistency_contract:
          "Rendered screenshot review evidence recorded for visual-html-skeleton/screenshots/desktop.png.",
        visual_validation_evidence: fixture.evidence,
        ui_data_contract: "Static visible source content only.",
        frontend_project: {
          status: "created",
          role: "visual_baseline_input",
          project_root: "../visual-html-skeleton",
          source_package: "web-clone-source",
          entrypoints: ["visual-html-skeleton/index.html"],
          generation_tool: "source-ir-static-html-skeleton",
          notes: ["Rendered screenshot review evidence recorded for visual-html-skeleton/screenshots/desktop.png."],
        },
        template_iteration_notes: ["checked parent-traversed project root", "checked downstream implementation handoff"],
        completeness_review: "A parent traversal must not satisfy the visual baseline project root contract.",
        reference_artifacts: ["web-clone-source/reference.png"],
        open_questions: [],
      },
      {},
    ),
  ).rejects.toThrow("project_root to point at visual-html-skeleton")

  expect(kit.getCollector().final).toBeUndefined()
})

test("submit_frontend_template rejects parent traversal that still ends in fd visual baseline root", async () => {
  const fixture = await createVisualEvidenceFixture()

  for (const projectRoot of [
    "../fd/visual-html-skeleton",
    "tmp/../../fd/visual-html-skeleton",
    "C:\\tmp\\fd\\visual-html-skeleton",
  ]) {
    const kit = createFrontendTemplateOutputTools({ artifactRoot: fixture.artifactRoot })
    const submit = kit.tools.submit_frontend_template as any

    await expect(
      submit.execute(
        {
          design_system: "source-derived static visual baseline",
          tech_stack: ["static HTML", "CSS"],
          final_acceptance_mode: "visual_baseline_allowed",
          frontend_template: "Render the captured page as a static HTML/CSS skeleton for visual parity only.",
          fillable_modules: "Static visual skeleton regions.",
          component_inventory: "Static visual skeleton regions.",
          component_reuse_plan: [
            {
              family_id: "comp-static-skeleton",
              name: "Static visual skeleton",
              observed_surface: "Full captured page first viewport",
              source_refs: ["web-clone-source/reference.png"],
              implementation_strategy: "extracted_baseline_defer",
              reuse_source: "visual-html-skeleton/index.html",
              mature_library_candidates: [],
              props_states: "static representative visual states only",
              replacement_boundary: "visual skeleton root",
              parity_guard:
                "Rendered screenshot review evidence recorded for visual-html-skeleton/screenshots/desktop.png.",
              project_specific_reason: "not applicable",
            },
          ],
          material_inventory: "source IR, CSS, assets, and reference pixels.",
          material_inventory_items: materialInventoryItems,
          visual_consistency_contract:
            "Rendered screenshot review evidence recorded for visual-html-skeleton/screenshots/desktop.png.",
          visual_validation_evidence: fixture.evidence,
          ui_data_contract: "Static visible source content only.",
          frontend_project: {
            status: "created",
            role: "visual_baseline_input",
            project_root: projectRoot,
            source_package: "web-clone-source",
            entrypoints: ["visual-html-skeleton/index.html"],
            generation_tool: "source-ir-static-html-skeleton",
            notes: ["Rendered screenshot review evidence recorded for visual-html-skeleton/screenshots/desktop.png."],
          },
          template_iteration_notes: ["checked parent-traversed fd project root", "checked downstream implementation handoff"],
          completeness_review: "A parent traversal must not satisfy the visual baseline project root contract.",
          reference_artifacts: ["web-clone-source/reference.png"],
          open_questions: [],
        },
        {},
      ),
    ).rejects.toThrow("project_root to point at visual-html-skeleton")

    expect(kit.getCollector().final).toBeUndefined()
  }
})

test("submit_frontend_template rejects Windows-equivalent dotted visual baseline roots", async () => {
  const fixture = await createVisualEvidenceFixture()

  for (const projectRoot of ["visual-html-skeleton.", "visual-html-skeleton /src"]) {
    const kit = createFrontendTemplateOutputTools({ artifactRoot: fixture.artifactRoot })
    const submit = kit.tools.submit_frontend_template as any

    await expect(
      submit.execute(
        {
          design_system: "source-derived static visual baseline",
          tech_stack: ["static HTML", "CSS"],
          final_acceptance_mode: "visual_baseline_allowed",
          frontend_template: "Render the captured page as a static HTML/CSS skeleton for visual parity only.",
          fillable_modules: "Static visual skeleton regions.",
          component_inventory: "Static visual skeleton regions.",
          component_reuse_plan: [
            {
              family_id: "comp-static-skeleton",
              name: "Static visual skeleton",
              observed_surface: "Full captured page first viewport",
              source_refs: ["web-clone-source/reference.png"],
              implementation_strategy: "extracted_baseline_defer",
              reuse_source: "visual-html-skeleton/index.html",
              mature_library_candidates: [],
              props_states: "static representative visual states only",
              replacement_boundary: "visual skeleton root",
              parity_guard:
                "Rendered screenshot review evidence recorded for visual-html-skeleton/screenshots/desktop.png.",
              project_specific_reason: "not applicable",
            },
          ],
          material_inventory: "source IR, CSS, assets, and reference pixels.",
          material_inventory_items: materialInventoryItems,
          visual_consistency_contract:
            "Rendered screenshot review evidence recorded for visual-html-skeleton/screenshots/desktop.png.",
          visual_validation_evidence: fixture.evidence,
          ui_data_contract: "Static visible source content only.",
          frontend_project: {
            status: "created",
            role: "visual_baseline_input",
            project_root: projectRoot,
            source_package: "web-clone-source",
            entrypoints: ["visual-html-skeleton/index.html"],
            generation_tool: "source-ir-static-html-skeleton",
            notes: ["Rendered screenshot review evidence recorded for visual-html-skeleton/screenshots/desktop.png."],
          },
          template_iteration_notes: ["checked dotted visual baseline project root", "checked downstream implementation handoff"],
          completeness_review: "Windows-equivalent dotted aliases must not be submitted as the visual baseline root.",
          reference_artifacts: ["web-clone-source/reference.png"],
          open_questions: [],
        },
        {},
      ),
    ).rejects.toThrow("project_root to point at visual-html-skeleton")

    expect(kit.getCollector().final).toBeUndefined()
  }
})

test("submit_frontend_template rejects symlinked visual validation artifacts outside the fd root", async () => {
  const fixture = await createVisualEvidenceFixture()
  const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), "outside-fd-root-"))
  const outsideScreenshotBytes = Buffer.from("outside fd rendered screenshot", "utf8")
  const screenshotsDir = path.join(fixture.artifactRoot, "visual-html-skeleton", "screenshots")
  await fs.rm(screenshotsDir, { recursive: true, force: true })
  await fs.writeFile(path.join(outsideRoot, "desktop.png"), outsideScreenshotBytes)
  await fs.symlink(outsideRoot, screenshotsDir, process.platform === "win32" ? "junction" : "dir")

  const kit = createFrontendTemplateOutputTools({ artifactRoot: fixture.artifactRoot })
  const submit = kit.tools.submit_frontend_template as any

  await expect(
    submit.execute(
      {
        design_system: "source-derived static visual baseline",
        tech_stack: ["static HTML", "CSS"],
        final_acceptance_mode: "visual_baseline_allowed",
        frontend_template: "Render the captured page as a static HTML/CSS skeleton for visual parity only.",
        fillable_modules: "Static visual skeleton regions.",
        component_inventory: "Static visual skeleton regions.",
        component_reuse_plan: [
          {
            family_id: "comp-static-skeleton",
            name: "Static visual skeleton",
            observed_surface: "Full captured page first viewport",
            source_refs: ["web-clone-source/reference.png"],
            implementation_strategy: "extracted_baseline_defer",
            reuse_source: "visual-html-skeleton/index.html",
            mature_library_candidates: [],
            props_states: "static representative visual states only",
            replacement_boundary: "visual skeleton root",
            parity_guard:
              "Rendered screenshot review evidence recorded for visual-html-skeleton/screenshots/desktop.png.",
            project_specific_reason: "not applicable",
          },
        ],
        material_inventory: "source IR, CSS, assets, and reference pixels.",
        material_inventory_items: materialInventoryItems,
        visual_consistency_contract:
          "Rendered screenshot review evidence recorded for visual-html-skeleton/screenshots/desktop.png.",
        visual_validation_evidence: visualValidationEvidence({
          screenshot_sha256: sha256(outsideScreenshotBytes),
          source_reference_sha256: fixture.evidence[0].source_reference_sha256,
          review_summary: "The screenshot path is a junction to a file outside the fd root.",
        }),
        ui_data_contract: "Static visible source content only.",
        frontend_project: {
          status: "created",
          role: "visual_baseline_input",
          project_root: "visual-html-skeleton",
          source_package: "web-clone-source",
          entrypoints: ["visual-html-skeleton/index.html"],
          generation_tool: "source-ir-static-html-skeleton",
          notes: ["Rendered screenshot review evidence recorded for visual-html-skeleton/screenshots/desktop.png."],
        },
        template_iteration_notes: ["checked symlinked screenshot", "checked downstream implementation handoff"],
        completeness_review: "Symlinked artifacts outside the fd root must not satisfy visual evidence.",
        reference_artifacts: ["web-clone-source/reference.png"],
        open_questions: [],
      },
      {},
    ),
  ).rejects.toThrow("requires artifact-backed rendered screenshot review evidence")

  expect(kit.getCollector().final).toBeUndefined()
})

test("submit_frontend_template accepts task-runtime-prefixed visual evidence paths under the same fd root", async () => {
  const fixture = await createVisualEvidenceFixture()
  const runtimeRoot = ".opencorvus/r/t/TS/KX/fd"
  const kit = createFrontendTemplateOutputTools({
    artifactRoot: fixture.artifactRoot,
    artifactRootRelative: runtimeRoot,
  })
  const submit = kit.tools.submit_frontend_template as any

  const out = await submit.execute(
    {
      design_system: "source-derived static visual baseline",
      tech_stack: ["static HTML", "CSS", "Playwright visual diff"],
      final_acceptance_mode: "visual_baseline_allowed",
      frontend_template: "Render the captured page as a static HTML/CSS skeleton for visual parity only.",
      fillable_modules: "Static visual skeleton regions.",
      component_inventory: "Static visual skeleton regions.",
      component_reuse_plan: [
        {
          family_id: "comp-static-skeleton",
          name: "Static visual skeleton",
          observed_surface: "Full captured page first viewport",
          source_refs: [`${runtimeRoot}/web-clone-source/reference.png`],
          implementation_strategy: "extracted_baseline_defer",
          reuse_source: `${runtimeRoot}/visual-html-skeleton/index.html`,
          mature_library_candidates: [],
          props_states: "static representative visual states only",
          replacement_boundary: "visual skeleton root",
          parity_guard: "Compare skeleton screenshot against source reference.png before transcription.",
          project_specific_reason: "not applicable",
        },
      ],
      material_inventory: "source IR, CSS, assets, and reference pixels.",
      material_inventory_items: materialInventoryItems,
      visual_consistency_contract:
        "Rendered screenshot review evidence recorded for task-runtime-prefixed visual skeleton paths.",
      visual_validation_evidence: visualValidationEvidence({
        rendered_entrypoint: `${runtimeRoot}/visual-html-skeleton/index.html`,
        screenshot_artifact: `${runtimeRoot}/visual-html-skeleton/screenshots/desktop.png`,
        source_reference_artifact: `${runtimeRoot}/web-clone-source/reference.png`,
        diff_artifact: `${runtimeRoot}/visual-html-skeleton/visual-diff.json`,
        screenshot_sha256: fixture.evidence[0].screenshot_sha256,
        source_reference_sha256: fixture.evidence[0].source_reference_sha256,
      }),
      ui_data_contract: "Static visible source content only.",
      frontend_project: {
        status: "created",
        role: "visual_baseline_input",
        project_root: `${runtimeRoot}/visual-html-skeleton`,
        source_package: `${runtimeRoot}/web-clone-source`,
        entrypoints: [
          `${runtimeRoot}/visual-html-skeleton/index.html`,
          `${runtimeRoot}/visual-html-skeleton/screenshots/desktop.png`,
        ],
        generation_tool: "source-ir-static-html-skeleton",
        notes: ["Rendered screenshot review evidence recorded for task-runtime-prefixed visual skeleton paths."],
      },
      template_iteration_notes: ["checked runtime-prefixed visual evidence", "checked downstream implementation handoff"],
      completeness_review: "Artifact-backed runtime-prefixed evidence was verified.",
      reference_artifacts: [`${runtimeRoot}/web-clone-source/reference.png`],
      open_questions: [],
    },
    {},
  )

  expect(out).toContain("OK")
  expect(kit.getCollector().final?.frontend_project.role).toBe("visual_baseline_input")
})

test("submit_frontend_template rejects visual baseline with blocking screenshot debt", async () => {
  const kit = createFrontendTemplateOutputTools()
  const submit = kit.tools.submit_frontend_template as any

  await expect(
    submit.execute(
      {
        design_system: "TradingView source-derived visual baseline",
        tech_stack: ["static HTML", "CSS", "Playwright visual diff"],
        final_acceptance_mode: "visual_baseline_allowed",
        frontend_template: "Restore the source-derived page into visual-html-skeleton/index.html.",
        fillable_modules: "All visible regions are represented, but map and icon fidelity still need repair.",
        component_inventory: "Static visual skeleton regions.",
        component_reuse_plan: [
          {
            family_id: "comp-static-skeleton",
            name: "Static visual skeleton",
            observed_surface: "Full captured page first viewport",
            source_refs: ["web-clone-source/reference.png"],
            implementation_strategy: "extracted_baseline_defer",
            reuse_source: "visual-html-skeleton/index.html",
            mature_library_candidates: [],
            props_states: "static representative visual states only",
            replacement_boundary: "visual skeleton root",
            parity_guard: "task-scoped preview screenshot inspection against reference.png",
            project_specific_reason: "not applicable",
          },
        ],
        baseline_replacement_plan: [],
        material_inventory: "web-clone-source source IR, source skeleton CSS, assets, and reference pixels.",
        material_inventory_items: materialInventoryItems,
        visual_consistency_contract:
          "Rendered screenshot review against reference.png reports map, table, legend, logo, and social icon visual debt.",
        visual_validation_evidence: visualValidationEvidence({
          review_status: "reviewed_with_blocking_debt",
          review_summary: "Rendered skeleton screenshot still shows blocking map, table, legend, logo, and icon debt.",
        }),
        ui_data_contract: "Static visible source content only.",
        frontend_project: {
          status: "created",
          role: "visual_baseline_input",
          project_root: "visual-html-skeleton",
          source_package: "web-clone-source",
          entrypoints: [
            "visual-html-skeleton/index.html",
            "visual-html-skeleton/styles/tokens.css",
            "visual-html-skeleton/screenshots/desktop.png",
          ],
          generation_tool: "source-ir-static-html-skeleton",
          notes: [
            "Rendered screenshot review recorded remaining visual debt for visual-html-skeleton/screenshots/desktop.png.",
            "Blocking visual debt: canvas map, table heat colors, simplified legend SVG, logo path, and social icons.",
            "The skeleton is a usable visual baseline for downstream transcription work.",
          ],
        },
        template_iteration_notes: ["checked rendered screenshot evidence and remaining debt", "checked downstream implementation handoff"],
        completeness_review: "Rendered screenshot evidence still shows blocking visual debt.",
        reference_artifacts: ["web-clone-source/reference.png", "visual-html-skeleton/index.html"],
        open_questions: [],
      },
      {},
    ),
  ).rejects.toThrow("cannot be submitted with blocking visual debt")

  expect(kit.getCollector().final).toBeUndefined()
})

for (const completenessReview of [
  "Visual debt remains: map, table, legend, logo, and social icons.",
  "Mismatches remain: map, table, legend, logo, and social icons.",
]) {
  test(`submit_frontend_template rejects visual baseline when debt remains phrasing is reversed: ${completenessReview}`, async () => {
    const fixture = await createVisualEvidenceFixture()
    const kit = createFrontendTemplateOutputTools({ artifactRoot: fixture.artifactRoot })
    const submit = kit.tools.submit_frontend_template as any

    await expect(
      submit.execute(
        {
          design_system: "TradingView source-derived visual baseline",
          tech_stack: ["static HTML", "CSS", "Playwright visual diff"],
          final_acceptance_mode: "visual_baseline_allowed",
          frontend_template: "Restore the source-derived page into visual-html-skeleton/index.html.",
          fillable_modules: "All visible regions are represented, but map and icon fidelity still need repair.",
          component_inventory: "Static visual skeleton regions.",
          component_reuse_plan: [
            {
              family_id: "comp-static-skeleton",
              name: "Static visual skeleton",
              observed_surface: "Full captured page first viewport",
              source_refs: ["web-clone-source/reference.png"],
              implementation_strategy: "extracted_baseline_defer",
              reuse_source: "visual-html-skeleton/index.html",
              mature_library_candidates: [],
              props_states: "static representative visual states only",
              replacement_boundary: "visual skeleton root",
              parity_guard: "task-scoped preview screenshot inspection against reference.png",
              project_specific_reason: "not applicable",
            },
          ],
          baseline_replacement_plan: [],
          material_inventory: "web-clone-source source IR, source skeleton CSS, assets, and reference pixels.",
          material_inventory_items: materialInventoryItems,
          visual_consistency_contract:
            "Rendered screenshot review evidence recorded for visual-html-skeleton/screenshots/desktop.png.",
          visual_validation_evidence: fixture.evidence,
          ui_data_contract: "Static visible source content only.",
          frontend_project: {
            status: "created",
            role: "visual_baseline_input",
            project_root: "visual-html-skeleton",
            source_package: "web-clone-source",
            entrypoints: [
              "visual-html-skeleton/index.html",
              "visual-html-skeleton/styles/tokens.css",
              "visual-html-skeleton/screenshots/desktop.png",
            ],
            generation_tool: "source-ir-static-html-skeleton",
            notes: [
              "Rendered screenshot review evidence recorded for visual-html-skeleton/screenshots/desktop.png.",
              "The skeleton is a usable visual baseline only after visual debt is resolved.",
            ],
          },
          template_iteration_notes: ["checked rendered screenshot evidence and remaining debt phrasing", "checked downstream implementation handoff"],
          completeness_review: completenessReview,
          reference_artifacts: ["web-clone-source/reference.png", "visual-html-skeleton/index.html"],
          open_questions: [],
        },
        {},
      ),
    ).rejects.toThrow("cannot be submitted with blocking visual debt")

    expect(kit.getCollector().final).toBeUndefined()
  })
}

test("submit_frontend_template accepts explicit no-blocking-debt screenshot review wording", async () => {
  const fixture = await createVisualEvidenceFixture()
  const kit = createFrontendTemplateOutputTools({ artifactRoot: fixture.artifactRoot })
  const submit = kit.tools.submit_frontend_template as any

  const out = await submit.execute(
    {
      design_system: "TradingView source-derived visual baseline",
      tech_stack: ["static HTML", "CSS", "Playwright visual diff"],
      final_acceptance_mode: "visual_baseline_allowed",
      frontend_template: "Restore the source-derived page into visual-html-skeleton/index.html.",
      fillable_modules: "All visible regions are represented in the validated visual skeleton.",
      component_inventory: "Static visual skeleton regions.",
      component_reuse_plan: [
        {
          family_id: "comp-static-skeleton",
          name: "Static visual skeleton",
          observed_surface: "Full captured page first viewport",
          source_refs: ["web-clone-source/reference.png"],
          implementation_strategy: "extracted_baseline_defer",
          reuse_source: "visual-html-skeleton/index.html",
          mature_library_candidates: [],
          props_states: "static representative visual states only",
          replacement_boundary: "visual skeleton root",
          parity_guard: "task-scoped preview screenshot inspection against reference.png",
          project_specific_reason: "not applicable",
        },
      ],
      baseline_replacement_plan: [],
      material_inventory: "web-clone-source source IR, source skeleton CSS, assets, and reference pixels.",
      material_inventory_items: materialInventoryItems,
      visual_consistency_contract:
        "Rendered screenshot review found no blocking visual debt in visual-html-skeleton/screenshots/desktop.png.",
      visual_validation_evidence: fixture.evidence,
      ui_data_contract: "Static visible source content only.",
      frontend_project: {
        status: "created",
        role: "visual_baseline_input",
        project_root: "visual-html-skeleton",
        source_package: "web-clone-source",
        entrypoints: [
          "visual-html-skeleton/index.html",
          "visual-html-skeleton/styles/tokens.css",
          "visual-html-skeleton/screenshots/desktop.png",
        ],
        generation_tool: "source-ir-static-html-skeleton",
        notes: ["Rendered screenshot review found no blocking visual debt."],
      },
      template_iteration_notes: ["checked rendered screenshot evidence and no blocking debt wording", "checked downstream implementation handoff"],
      completeness_review: "Rendered screenshot review found no blocking visual debt.",
      reference_artifacts: ["web-clone-source/reference.png", "visual-html-skeleton/index.html"],
      open_questions: [],
    },
    {},
  )

  expect(out).toContain("OK")
  expect(kit.getCollector().final?.frontend_project.role).toBe("visual_baseline_input")
})

test("visual baseline workflow reports source baseline submissions as incomplete frontend_design work", async () => {
  const kit = createFrontendTemplateOutputTools()
  const submit = kit.tools.submit_frontend_template as any

  await submit.execute(
    {
      design_system: "source-derived static visual baseline",
      tech_stack: ["static HTML", "CSS", "Playwright visual diff"],
      final_acceptance_mode: "visual_baseline_allowed",
      frontend_template: "Restore the captured page into a source-editable static HTML/CSS visual skeleton.",
      fillable_modules:
        "Create visual-html-skeleton/index.html, tokens.css, regional CSS, assets, screenshots, and visual diff evidence.",
      component_inventory: "Static visual skeleton regions.",
      component_reuse_plan: [
        {
          family_id: "comp-static-skeleton",
          name: "Static visual skeleton",
          observed_surface: "Full captured page",
          source_refs: ["web-clone-source/reference.png"],
          implementation_strategy: "extracted_baseline_defer",
          reuse_source: "frontend-design-skeleton",
          mature_library_candidates: [],
          props_states: "static representative visual states",
          replacement_boundary: "visual skeleton root",
          parity_guard: "Compare the restored static skeleton against reference.png.",
          project_specific_reason: "not applicable",
        },
      ],
      baseline_replacement_plan: [],
      material_inventory: "web-clone-source source IR, source skeleton CSS, assets, and reference pixels.",
      material_inventory_items: materialInventoryItems,
      visual_consistency_contract: "Visual review against web-clone-source/reference.png.",
      ui_data_contract: "Static visible source content only.",
      frontend_project: {
        status: "created",
        role: "source_baseline_input",
        project_root: "frontend-design-skeleton",
        source_package: "web-clone-source",
        entrypoints: ["README.md", "src/App.tsx", "src/components/SourceDomPage.tsx"],
        generation_tool: "host-prepared:create_frontend_skeleton_project",
        notes: ["Captured source evidence exists, but the visual HTML skeleton was not restored."],
      },
      template_iteration_notes: ["checked visual-only output contract", "checked downstream implementation handoff"],
      completeness_review: "Not complete: this is still the captured source evidence baseline.",
      reference_artifacts: ["web-clone-source/reference.png"],
      open_questions: [],
    },
    {},
  )

  const report = buildFrontendTemplateReport(kit.getCollector()).detail
  expect(report).toContain("- role: source_baseline_input")
  expect(report).toContain("visual_status: incomplete_visual_baseline")
  expect(report).toContain("visual_next_action")
  expect(report).toContain("Visual HTML Skeleton Workflow Incomplete")
  expect(report).toContain("frontend_design must deliver `frontend_project.role=visual_baseline_input`")
  expect(report).toContain("Do not ask other agents to reinterpret `frontend-design-skeleton`")
  expect(report).toContain("frontend-design-skeleton is captured source evidence only")
})

test("component reuse plan accepts canonical provider fields and incomplete library hints without schema rejection", async () => {
  const submit = createFrontendTemplateOutputTools().tools.submit_frontend_template as any
  const base = {
    design_system: "custom dashboard",
    tech_stack: ["React"],
    final_acceptance_mode: "visual_baseline_allowed",
    frontend_template: "frontend template",
    fillable_modules: "fillable modules",
    component_inventory: "component inventory",
    material_inventory: "materials",
    material_inventory_items: materialInventoryItems,
    visual_consistency_contract: "visual contract",
    ui_data_contract: "data contract",
    implementation_phase_outcomes: implementationPhaseOutcomes,
    frontend_project: {
      status: "created",
      role: "source_baseline_input",
      project_root: "frontend-design-skeleton",
      source_package: "web-clone-source",
      entrypoints: ["README.md", "src/App.tsx", "src/styles.css"],
      generation_tool: "host-prepared:create_frontend_skeleton_project",
      notes: ["source baseline ready"],
    },
    template_iteration_notes: ["checked inventory", "checked downstream implementation handoff"],
    completeness_review: "complete enough",
    reference_artifacts: [],
    open_questions: [],
  }

  const okWithProviderIds = await submit.execute(
    {
      ...base,
      component_reuse_plan: [
        {
          family_id: "MarketTable",
          name: "Table",
          observed_surface: "Data table",
          source_refs: [],
          implementation_strategy: "mature_library",
          reuse_source: "not specified",
          mature_library_candidates: [],
          props_states: "rows and sort state",
          replacement_boundary: "table region",
          parity_guard: "visual diff",
          project_specific_reason: "not applicable",
        },
      ],
      baseline_replacement_plan: [
        {
          boundary_id: "market-table-boundary",
          source_region: "table region",
          action: "defer_baseline_until_parity",
          component_family_id: "MarketTable",
          replacement_strategy: "mature_library",
          reuse_source: "not specified",
          mature_library_candidates: [],
          deletion_rule: "Keep baseline until visual parity is proven.",
          source_refs: [],
          parity_guard: "visual diff",
        },
      ],
    },
    {},
  )

  expect(okWithProviderIds).toContain("OK")

  const secondSubmit = createFrontendTemplateOutputTools().tools.submit_frontend_template as any
  const ok = await submit.execute(
    {
      ...base,
      component_reuse_plan: [
        {
          family_id: "comp-table",
          name: "Table",
          observed_surface: "Data table",
          source_refs: [],
          implementation_strategy: "project_specific_component",
          reuse_source: "not found after inspecting src/components",
          mature_library_candidates: [],
          props_states: "rows and sort state",
          replacement_boundary: "table region",
          parity_guard: "visual diff",
        },
      ],
    },
    {},
  )

  expect(ok).toContain("already submitted")
  const secondOk = await secondSubmit.execute(
    {
      ...base,
      component_reuse_plan: [
        {
          family_id: "Table",
          name: "Table",
          observed_surface: "Data table",
          source_refs: [],
          implementation_strategy: "project_specific_component",
          reuse_source: "not found after inspecting src/components",
          mature_library_candidates: [],
          props_states: "rows and sort state",
          replacement_boundary: "table region",
          parity_guard: "visual diff",
        },
      ],
    },
    {},
  )
  expect(secondOk).toContain("OK")
})

test("maintainable acceptance does not synthesize a whole-page source baseline replacement plan", async () => {
  const kit = createFrontendTemplateOutputTools()
  const submit = kit.tools.submit_frontend_template as any
  const base = {
    design_system: "custom dashboard",
    tech_stack: ["React"],
    final_acceptance_mode: "maintainable_replacement_required",
    frontend_template: "frontend template",
    fillable_modules: "fillable modules",
    component_inventory: "component inventory",
    component_reuse_plan: [
      {
        family_id: "comp-table",
        name: "Table",
        observed_surface: "Data table",
        source_refs: [],
        implementation_strategy: "mature_library",
        reuse_source: "TanStack Table",
        mature_library_candidates: ["@tanstack/react-table"],
        props_states: "rows and sort state",
        replacement_boundary: "table region",
        parity_guard: "visual diff",
        project_specific_reason: "not applicable",
      },
    ],
    material_inventory: "materials",
    material_inventory_items: materialInventoryItems,
    visual_consistency_contract: "visual contract",
    ui_data_contract: "data contract",
    implementation_phase_outcomes: implementationPhaseOutcomes,
    frontend_project: {
      status: "created",
      role: "source_baseline_input",
      project_root: "frontend-design-skeleton",
      source_package: "web-clone-source",
      entrypoints: ["README.md", "src/App.tsx", "src/styles.css"],
      generation_tool: "host-prepared:create_frontend_skeleton_project",
      notes: ["source baseline ready"],
    },
    template_iteration_notes: ["checked inventory", "checked downstream implementation handoff"],
    completeness_review: "complete enough",
    reference_artifacts: [],
    open_questions: [],
  }

  const okWithoutPlan = await submit.execute(
    {
      ...base,
      baseline_replacement_plan: [],
    },
    {},
  )

  expect(okWithoutPlan).toContain("OK")
  expect(kit.getCollector().final?.component_reuse_plan.map((item) => item.family_id)).not.toContain(
    "comp-source-page-baseline",
  )
  expect(kit.getCollector().final?.baseline_replacement_plan).toHaveLength(0)
  expect(kit.getCollector().final?.quality_project_contract).not.toContain("source-page-baseline")

  const secondSubmit = await submit.execute(
    {
      ...base,
      baseline_replacement_plan: [
        {
          boundary_id: "replace-market-table",
          source_region: "frontend-design-skeleton table DOM region",
          action: "replace_generated_baseline",
          component_family_id: "comp-table",
          replacement_strategy: "mature_library",
          reuse_source: "@tanstack/react-table",
          mature_library_candidates: ["@tanstack/react-table"],
          deletion_rule: "Remove the generated table HTML after the component passes visual diff.",
          source_refs: ["web-clone-source/source-ir/content-model.json"],
          parity_guard: "Run visual diff and source audit.",
          project_specific_reason: "not applicable",
        },
      ],
    },
    {},
  )

  expect(secondSubmit).toContain("already submitted")
})

test("baseline replacement project-specific reason is optional provider detail", async () => {
  const submit = createFrontendTemplateOutputTools().tools.submit_frontend_template as any

  const ok = await submit.execute(
    {
      design_system: "custom dashboard",
      tech_stack: ["React"],
      final_acceptance_mode: "maintainable_replacement_required",
      frontend_template: "frontend template",
      fillable_modules: "fillable modules",
      component_inventory: "component inventory",
      component_reuse_plan: [
        {
          family_id: "comp-table",
          name: "Table",
          observed_surface: "Data table",
          source_refs: [],
          implementation_strategy: "project_specific_component",
          reuse_source: "not found after inspecting src/components",
          mature_library_candidates: [],
          props_states: "rows and sort state",
          replacement_boundary: "table region",
          parity_guard: "visual diff",
        },
      ],
      baseline_replacement_plan: [
        {
          boundary_id: "replace-market-table",
          source_region: "frontend-design-skeleton table DOM region",
          action: "replace_generated_baseline",
          component_family_id: "comp-table",
          replacement_strategy: "project_specific_component",
          reuse_source: "not found after inspecting src/components",
          mature_library_candidates: [],
          deletion_rule: "Remove generated table HTML after the replacement is visually equivalent.",
          source_refs: ["web-clone-source/source-ir/content-model.json"],
          parity_guard: "Run visual diff and source audit.",
        },
      ],
      implementation_phase_outcomes: implementationPhaseOutcomes,
      material_inventory: "materials",
      material_inventory_items: materialInventoryItems,
      visual_consistency_contract: "visual contract",
      ui_data_contract: "data contract",
      template_iteration_notes: ["checked inventory", "checked downstream implementation handoff"],
      completeness_review: "complete enough",
      reference_artifacts: [],
      open_questions: [],
    },
    {},
  )

  expect(ok).toContain("OK")
})

test("submit_frontend_template closes collector against duplicate submit and late visual rows", async () => {
  const kit = createFrontendTemplateOutputTools()
  const submit = kit.tools.submit_frontend_template as any

  const payload = {
    design_system: "custom dashboard",
    tech_stack: ["React"],
    final_acceptance_mode: "visual_baseline_allowed",
    frontend_template: "frontend template",
    fillable_modules: "fillable modules",
    component_inventory: "component inventory",
    component_reuse_plan: [
      {
        family_id: "comp-table",
        name: "Table",
        observed_surface: "Data table",
        source_refs: [],
        implementation_strategy: "mature_library",
        reuse_source: "TanStack Table",
        mature_library_candidates: ["@tanstack/react-table"],
        props_states: "rows and sort state",
        replacement_boundary: "table region",
        parity_guard: "visual diff",
        project_specific_reason: "not applicable",
      },
    ],
    baseline_replacement_plan: [],
    material_inventory: "materials",
    material_inventory_items: materialInventoryItems,
    visual_consistency_contract: "visual contract",
    ui_data_contract: "data contract",
    template_iteration_notes: ["checked inventory", "checked downstream implementation handoff"],
    completeness_review: "complete enough",
    reference_artifacts: [],
    open_questions: [],
  }

  const ok = await submit.execute(payload, {})
  expect(ok).toContain("OK")

  const duplicate = await submit.execute(payload, {})
  expect(duplicate).toContain("already submitted")

  const late = await kit.tools.register_color_spec.execute(
    {
      id: "vis-color-late",
      title: "Late color",
      hex: "#ffffff",
      role: "background",
      applies_to: "body",
      severity: "must",
    },
    {} as any,
  )
  expect(late).toContain("already submitted")
  expect(kit.getCollector().specs).toHaveLength(0)
})
