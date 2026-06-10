import { expect, test } from "bun:test"
import { asSchema } from "ai"
import {
  FrontendTemplateFinalSchema,
  FrontendTemplateToolInputSchema,
  VisualSpecSchema,
} from "../../src/frontend-design/schema"

test("frontend-design schema module owns compact submit schema and visual spec schema", () => {
  const providerSchema = asSchema(FrontendTemplateToolInputSchema).jsonSchema

  expect(providerSchema.required).toContain("final_acceptance_mode")
  expect(providerSchema.required).toContain("material_inventory_items")
  expect(providerSchema.properties?.material_inventory_items).toHaveProperty("minItems", 1)
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

  const final = FrontendTemplateFinalSchema.parse({
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
  })

  expect(final.fact_check_items).toEqual([])
  expect(final.frontend_project.role).toBe("source_baseline_input")
})
