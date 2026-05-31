import { expect, test } from "bun:test"
import { asSchema } from "ai"
import { createFrontendTemplateOutputTools } from "../../src/frontend-design/output-tools"

test("submit_frontend_template defaults missing fact_check_items during direct execution", async () => {
  const kit = createFrontendTemplateOutputTools()

  const out = await kit.tools.submit_frontend_template.execute!(
    {
      design_system: "custom chart workspace",
      tech_stack: ["React", "mock API"],
      final_delivery_mode: "visual_baseline_allowed",
      frontend_template: "# Chart Page\nReplica page with chart, toolbar, and sidebar.",
      fillable_modules: "Implement chart layout, header controls, sidebars, and responsive states.",
      component_inventory: "Chart shell, toolbar, and sidebar components.",
      component_reuse_plan: [
        {
          family_id: "comp-chart-shell",
          name: "Chart shell",
          observed_surface: "Main chart area",
          source_refs: ["mirror/reference.png"],
          implementation_strategy: "mature_library",
          reuse_source: "lightweight-charts",
          mature_library_candidates: ["lightweight-charts"],
          props_states: "series data, crosshair state, hover state",
          replacement_boundary: "Replace chart DOM region only after parity screenshot passes.",
          parity_guard: "Compare rendered chart against reference.png.",
          custom_fallback_reason: "not applicable",
        },
      ],
      baseline_replacement_plan: [],
      material_inventory: "Quote/candle fixture data and chart visual tokens.",
      visual_consistency_contract: "Match the observed chart workspace spacing, colors, and control density.",
      ui_data_contract: "Provide local quote and candle endpoints with deterministic mock data.",
      template_iteration_notes: ["Checked page inventory and downstream implementability."],
      completeness_review: "Complete enough for requirements and architect handoff.",
      reference_artifacts: [],
      open_questions: [],
    } as any,
    {} as any,
  )

  expect(out).toContain("OK")
  expect(kit.getCollector().final?.fact_check_items).toEqual([])
  expect(kit.getCollector().final?.final_delivery_mode).toBe("visual_baseline_allowed")
})

test("submit_frontend_template provider schema requires explicit final_delivery_mode", () => {
  const schema = asSchema(createFrontendTemplateOutputTools().tools.submit_frontend_template.inputSchema).jsonSchema

  expect(schema.required).toContain("final_delivery_mode")
  expect(schema.properties?.final_delivery_mode).not.toHaveProperty("default")
})

test("submit_frontend_template tolerates missing review fields from provider tool calls", async () => {
  const kit = createFrontendTemplateOutputTools({ autoIteration: true })
  const submit = kit.tools.submit_frontend_template as any

  const out = await submit.execute({
    design_system: "custom financial page",
    tech_stack: ["React", "Vite"],
    final_delivery_mode: "maintainable_replacement_required",
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
        custom_fallback_reason: "not applicable",
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
        custom_fallback_reason: "not applicable",
      },
    ],
    material_inventory: "materials",
    visual_consistency_contract: "visual contract",
    ui_data_contract: "data contract",
  }, {})

  expect(out).toContain("OK")
  expect(kit.getCollector().final?.template_iteration_notes).toHaveLength(2)
  expect(kit.getCollector().final?.completeness_review).toContain("structurally complete")
})

test("submit_frontend_template rebuilds flattened frontend_project provider args", async () => {
  const kit = createFrontendTemplateOutputTools()
  const submit = kit.tools.submit_frontend_template as any

  await submit.execute({
    design_system: "custom financial page",
    tech_stack: ["React", "Vite"],
    final_delivery_mode: "visual_baseline_allowed",
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
        custom_fallback_reason: "not applicable",
      },
    ],
    baseline_replacement_plan: [],
    material_inventory: "materials",
    visual_consistency_contract: "visual contract",
    ui_data_contract: "data contract",
    template_iteration_notes: ["checked inventory"],
    completeness_review: "complete enough",
    "frontend_project<arg_key>status": "created",
    "frontend_project<arg_key>role": "visual_baseline_input",
    "frontend_project<arg_key>project_root": "frontend-design-skeleton",
    "frontend_project<arg_key>source_package": "web-clone-source",
    "frontend_project<arg_key>entrypoints": "[\"README.md\",\"src/App.jsx\"]",
    "frontend_project<arg_key>generation_tool": "host-prepared:create_frontend_skeleton_project",
    "frontend_project<arg_key>notes": "[\"baseline input only\"]",
  }, {})

  const project = kit.getCollector().final?.frontend_project
  expect(project?.status).toBe("created")
  expect(project?.project_root).toBe("frontend-design-skeleton")
  expect(project?.entrypoints).toEqual(["README.md", "src/App.jsx"])
  expect(project?.notes).toEqual(["baseline input only"])
})

test("component inventory schema documents reuse-before-custom policy", () => {
  const description = (createFrontendTemplateOutputTools().tools.submit_frontend_template as any).inputSchema.shape.component_inventory.description

  expect(description).toContain("existing project component")
  expect(description).toContain("mature maintained library")
  expect(description).toContain("custom fallback")
  expect(description).toContain("Do not hand-roll complex")
})

test("final delivery mode schema does not call raw baseline shippable", () => {
  const description = (createFrontendTemplateOutputTools().tools.submit_frontend_template as any).inputSchema.shape.final_delivery_mode.description

  expect(description).toContain("visual baseline is always input/evidence")
  expect(description).toContain("Required explicit delivery mode")
  expect(description).not.toContain("may ship the generated visual baseline")
})

test("reference artifacts schema discourages exhaustive raw file lists", () => {
  const description = (createFrontendTemplateOutputTools().tools.submit_frontend_template as any).inputSchema.shape.reference_artifacts.description

  expect(description).toContain("Compact artifact anchors")
  expect(description).toContain("targeted-gap evidence")
  expect(description).not.toContain("mirror/extracted-page.json")
})

test("submit_frontend_template renders compact structured fields into markdown handoff", async () => {
  const kit = createFrontendTemplateOutputTools()
  const submit = kit.tools.submit_frontend_template as any

  await submit.execute({
    design_system: "custom financial page",
    tech_stack: ["React", "Vite"],
    final_delivery_mode: "maintainable_replacement_required",
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
        custom_fallback_reason: "not applicable",
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
        custom_fallback_reason: "not applicable",
      },
    ],
    material_inventory_items: [
      { title: "Reference", detail: "Use reference.png as pixel truth.", source_refs: ["web-clone-source/reference.png"] },
    ],
    quality_project_items: [
      { title: "Source layout", detail: "Build src/pages/MarketsPage.tsx from semantic components, not raw extracted DOM injection.", source_refs: ["frontend-design-skeleton/src/slots.json"] },
      { title: "Verification", detail: "Run visual diff against reference.png and source audit before reporting pass.", source_refs: ["web-clone-source/reference.png"] },
    ],
    frontend_project: {
      status: "created",
      role: "visual_baseline_input",
      project_root: "frontend-design-skeleton",
      source_package: "web-clone-source",
      entrypoints: ["README.md", "src/App.jsx"],
      generation_tool: "singlefile-react-baseline",
      notes: ["raw DOM/CSS baseline only"],
    },
    visual_consistency_items: [
      { title: "Desktop", detail: "Desktop viewport must match reference.png at the configured threshold.", source_refs: ["web-clone-source/reference.png"] },
    ],
    ui_data_contract_items: [
      { title: "Rows", detail: "Country rows are local mock records, not duplicated JSX.", source_refs: ["web-clone-source/source-ir/content-model.json"] },
    ],
    template_iteration_notes: ["checked compact handoff"],
    completeness_review: "complete enough",
  }, {})

  const final = kit.getCollector().final
  expect(final?.frontend_template).toContain("Route")
  expect(final?.fillable_modules).toContain("Markets table")
  expect(final?.component_inventory).toContain("comp-table")
  expect(final?.quality_project_contract).toContain("Source layout")
  expect(final?.quality_project_contract).toContain("not raw extracted DOM injection")
  expect(final?.frontend_project.role).toBe("visual_baseline_input")
  expect(final?.material_inventory).toContain("Reference")
  expect(final?.visual_consistency_contract).toContain("Desktop")
  expect(final?.ui_data_contract).toContain("Rows")
})

test("component reuse plan enforces mature library and custom fallback detail", async () => {
  const submit = createFrontendTemplateOutputTools().tools.submit_frontend_template as any
  const base = {
    design_system: "custom dashboard",
    tech_stack: ["React"],
    final_delivery_mode: "visual_baseline_allowed",
    frontend_template: "frontend template",
    fillable_modules: "fillable modules",
    component_inventory: "component inventory",
    material_inventory: "materials",
    visual_consistency_contract: "visual contract",
    ui_data_contract: "data contract",
    template_iteration_notes: ["checked inventory"],
    completeness_review: "complete enough",
    reference_artifacts: [],
    open_questions: [],
  }

  await expect(submit.execute({
    ...base,
    component_reuse_plan: [
      {
        family_id: "comp-table",
        name: "Table",
        observed_surface: "Data table",
        source_refs: [],
        implementation_strategy: "mature_library",
        reuse_source: "not specified",
        mature_library_candidates: [],
        props_states: "rows and sort state",
        replacement_boundary: "table region",
        parity_guard: "visual diff",
        custom_fallback_reason: "not applicable",
      },
    ],
  }, {})).rejects.toThrow("mature_library")

  await expect(submit.execute({
    ...base,
    component_reuse_plan: [
      {
        family_id: "comp-table",
        name: "Table",
        observed_surface: "Data table",
        source_refs: [],
        implementation_strategy: "custom_fallback",
        reuse_source: "not found after inspecting src/components",
        mature_library_candidates: [],
        props_states: "rows and sort state",
        replacement_boundary: "table region",
        parity_guard: "visual diff",
        custom_fallback_reason: "not applicable",
      },
    ],
  }, {})).rejects.toThrow("custom_fallback")
})

test("maintainable delivery requires generated baseline replacement plan", async () => {
  const submit = createFrontendTemplateOutputTools().tools.submit_frontend_template as any
  const base = {
    design_system: "custom dashboard",
    tech_stack: ["React"],
    final_delivery_mode: "maintainable_replacement_required",
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
        custom_fallback_reason: "not applicable",
      },
    ],
    material_inventory: "materials",
    visual_consistency_contract: "visual contract",
    ui_data_contract: "data contract",
    template_iteration_notes: ["checked inventory"],
    completeness_review: "complete enough",
    reference_artifacts: [],
    open_questions: [],
  }

  await expect(submit.execute({
    ...base,
    baseline_replacement_plan: [],
  }, {})).rejects.toThrow("baseline_replacement_plan")

  const ok = await submit.execute({
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
        custom_fallback_reason: "not applicable",
      },
    ],
  }, {})

  expect(ok).toContain("OK")
})

test("submit_frontend_template closes collector against duplicate submit and late visual rows", async () => {
  const kit = createFrontendTemplateOutputTools()
  const submit = kit.tools.submit_frontend_template as any

  const payload = {
    design_system: "custom dashboard",
    tech_stack: ["React"],
    final_delivery_mode: "visual_baseline_allowed",
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
        custom_fallback_reason: "not applicable",
      },
    ],
    baseline_replacement_plan: [],
    material_inventory: "materials",
    visual_consistency_contract: "visual contract",
    ui_data_contract: "data contract",
    template_iteration_notes: ["checked inventory"],
    completeness_review: "complete enough",
    reference_artifacts: [],
    open_questions: [],
  }

  const ok = await submit.execute(payload, {})
  expect(ok).toContain("OK")

  const duplicate = await submit.execute(payload, {})
  expect(duplicate).toContain("already submitted")

  const late = await kit.tools.register_color_spec.execute({
    id: "vis-color-late",
    title: "Late color",
    hex: "#ffffff",
    role: "background",
    applies_to: "body",
    severity: "must",
  }, {} as any)
  expect(late).toContain("already submitted")
  expect(kit.getCollector().specs).toHaveLength(0)
})
