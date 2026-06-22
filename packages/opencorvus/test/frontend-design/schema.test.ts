import { expect, test } from "bun:test"
import { asSchema } from "ai"
import {
  FrontendTemplateFinalSchema,
  FrontendTemplateToolInputSchema,
  VisualSpecSchema,
} from "../../src/frontend-design/schema"

function minimalFrontendTemplateInput() {
  return {
    design_system: "source-derived visual baseline",
    tech_stack: ["static HTML", "CSS"],
    final_acceptance_mode: "visual_baseline_allowed",
    material_inventory_items: [
      {
        title: "Source materials",
        detail: "Use reference pixels, source CSS tokens, and assets for the visual skeleton.",
        source_refs: ["web-clone-source/reference.png"],
      },
    ],
    component_reuse_plan: [
      {
        family_id: "comp-shell",
        name: "Static shell",
        observed_surface: "Full page",
        implementation_strategy: "extracted_baseline_defer",
        reuse_source: "visual-html-skeleton/index.html",
        props_states: "static visual state",
        replacement_boundary: "page shell",
        parity_guard: "Compare against reference.png",
      },
    ],
    open_questions: [],
  }
}

function visualValidationEvidence() {
  return {
    id: "evidence-desktop",
    render_target: "visual-html-skeleton",
    rendered_entrypoint: "visual-html-skeleton/index.html",
    screenshot_artifact: "visual-html-skeleton/screenshots/desktop.png",
    source_reference_artifact: "web-clone-source/reference.png",
    renderer: "node_playwright_static_file",
    viewport: "desktop-320x180",
    screenshot_sha256: "a".repeat(64),
    source_reference_sha256: "b".repeat(64),
    diff_artifact: "visual-html-skeleton/visual-diff.json",
    review_status: "reviewed_no_blocking_debt",
    review_summary: "Rendered screenshot was reviewed against the source reference.",
  }
}

test("frontend-design schema module owns compact submit schema and visual spec schema", () => {
  const providerSchema = asSchema(FrontendTemplateToolInputSchema).jsonSchema as any

  expect(providerSchema.required).toContain("final_acceptance_mode")
  expect(providerSchema.required).toContain("material_inventory_items")
  expect(providerSchema.properties?.material_inventory_items).toHaveProperty("minItems", 1)
  expect(providerSchema.properties?.component_reuse_plan?.items?.properties?.reuse_source?.description).toContain(
    "Concrete reuse target",
  )
  expect(providerSchema.properties?.component_reuse_plan?.items?.properties?.reuse_source?.description).toContain(
    "installed package",
  )
  expect(providerSchema.properties?.baseline_replacement_plan?.items?.properties?.reuse_source?.description).toContain(
    "Explanatory prose belongs",
  )
  expect(providerSchema.properties?.frontend_project?.properties?.entrypoints?.description).toContain(
    "role=implementation_target",
  )
  expect(providerSchema.properties?.frontend_project?.properties?.entrypoints?.description).toContain(
    "role=visual_baseline_input",
  )
  expect(JSON.stringify(providerSchema).length).toBeLessThan(12_000)
  expect(
    VisualSpecSchema.parse({
      id: "vis-color-primary",
      category: "color",
      title: "Primary color",
      requirement: "#ffffff",
      applies_to: "body",
      severity: "must",
    }).category,
  ).toBe("color")

  const final = FrontendTemplateFinalSchema.parse(minimalFrontendTemplateInput())

  expect(final.fact_check_items).toEqual([])
  expect(final.frontend_project.role).toBe("source_baseline_input")
})

test("frontend-design submit schemas reject unknown fields instead of stripping evidence contract drift", () => {
  const base = minimalFrontendTemplateInput()

  expect(FrontendTemplateToolInputSchema.safeParse(base).success).toBe(true)
  expect(FrontendTemplateFinalSchema.safeParse(base).success).toBe(true)
  expect(FrontendTemplateToolInputSchema.safeParse({ ...base, sourceUrl: "https://example.com" }).success).toBe(false)
  expect(FrontendTemplateFinalSchema.safeParse({ ...base, sourceUrl: "https://example.com" }).success).toBe(false)

  expect(
    FrontendTemplateToolInputSchema.safeParse({
      ...base,
      frontend_project: {
        status: "created",
        role: "visual_baseline_input",
        project_root: "visual-html-skeleton",
        source_package: "web-clone-source",
        entrypoints: ["visual-html-skeleton/index.html"],
        generation_tool: "source-ir-static-html-skeleton",
        notes: ["visual baseline"],
        sourceUrl: "https://example.com",
      },
    }).success,
  ).toBe(false)

  expect(
    FrontendTemplateFinalSchema.safeParse({
      ...base,
      frontend_project: {
        status: "created",
        role: "visual_baseline_input",
        project_root: "visual-html-skeleton",
        source_package: "web-clone-source",
        entrypoints: ["visual-html-skeleton/index.html"],
        generation_tool: "source-ir-static-html-skeleton",
        notes: ["visual baseline"],
        sourceUrl: "https://example.com",
      },
    }).success,
  ).toBe(false)

  expect(
    FrontendTemplateToolInputSchema.safeParse({
      ...base,
      visual_validation_evidence: [{ ...visualValidationEvidence(), screenshotUrl: "screenshots/desktop.png" }],
    }).success,
  ).toBe(false)

  expect(
    FrontendTemplateFinalSchema.safeParse({
      ...base,
      visual_validation_evidence: [{ ...visualValidationEvidence(), screenshotUrl: "screenshots/desktop.png" }],
    }).success,
  ).toBe(false)

  expect(
    FrontendTemplateFinalSchema.safeParse({
      ...base,
      component_reuse_plan: [{ ...base.component_reuse_plan[0], screenshotArtifact: "screenshots/desktop.png" }],
    }).success,
  ).toBe(false)

  expect(
    FrontendTemplateToolInputSchema.safeParse({
      ...base,
      component_reuse_plan: [{ ...base.component_reuse_plan[0], screenshotArtifact: "screenshots/desktop.png" }],
    }).success,
  ).toBe(false)

  const baselineReplacementPlan = [
    {
      boundary_id: "boundary-shell",
      source_region: "visual-html-skeleton/main",
      action: "replace_generated_baseline",
      component_family_id: "comp-shell",
      replacement_strategy: "existing_project_component",
      reuse_source: "src/components/Shell.tsx",
      deletion_rule: "Remove generated shell only after visual parity passes.",
      parity_guard: "Compare against reference.png",
      source_refs: ["visual-html-skeleton/index.html"],
    },
  ]
  expect(
    FrontendTemplateFinalSchema.safeParse({
      ...base,
      baseline_replacement_plan: [{ ...baselineReplacementPlan[0], sourceUrl: "https://example.com" }],
    }).success,
  ).toBe(false)
  expect(
    FrontendTemplateToolInputSchema.safeParse({
      ...base,
      baseline_replacement_plan: [{ ...baselineReplacementPlan[0], sourceUrl: "https://example.com" }],
    }).success,
  ).toBe(false)

  expect(
    FrontendTemplateFinalSchema.safeParse({
      ...base,
      quality_project_items: [
        {
          title: "Quality",
          detail: "Verify source-backed visual parity.",
          source_refs: ["web-clone-source/reference.png"],
          sourceUrl: "https://example.com",
        },
      ],
    }).success,
  ).toBe(false)

  expect(
    FrontendTemplateToolInputSchema.safeParse({
      ...base,
      frontend_template_sections: [
        {
          title: "Template",
          detail: "Use source-backed visual parity.",
          source_refs: ["web-clone-source/reference.png"],
          sourceUrl: "https://example.com",
        },
      ],
    }).success,
  ).toBe(false)

  expect(
    FrontendTemplateFinalSchema.safeParse({
      ...base,
      material_inventory_items: [{ ...base.material_inventory_items[0], sourceUrl: "https://example.com" }],
    }).success,
  ).toBe(false)

  expect(
    FrontendTemplateToolInputSchema.safeParse({
      ...base,
      material_inventory_items: [{ ...base.material_inventory_items[0], sourceUrl: "https://example.com" }],
    }).success,
  ).toBe(false)
})
