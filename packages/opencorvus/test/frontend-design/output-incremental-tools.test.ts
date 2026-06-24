import { expect, test } from "bun:test"
import { asSchema } from "ai"
import { createFrontendTemplateOutputTools } from "../../src/frontend-design/output-tools"

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

test("update_frontend tools assemble and finalize the canonical frontend template", async () => {
  const kit = await registerMinimalFrontendResult()

  const result = await callTool(kit.tools, "submit_frontend_template", { final: true })

  expect(result).toContain("OK")
  expect(kit.getCollector().final?.frontend_template).toContain("Desktop page skeleton")
  expect(kit.getCollector().final?.component_reuse_plan[0]?.family_id).toBe("market-card-grid")
  expect(kit.getCollector().final?.implementation_phase_outcomes).toHaveLength(5)
})
