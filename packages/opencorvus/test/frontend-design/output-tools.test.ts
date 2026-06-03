import { expect, test } from "bun:test"
import { asSchema } from "ai"
import { buildFrontendTemplateReport, createFrontendTemplateOutputTools } from "../../src/frontend-design/output-tools"

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
  expect(kit.getCollector().final?.final_acceptance_mode).toBe("visual_baseline_allowed")
})

test("submit_frontend_template provider schema requires explicit final_acceptance_mode", () => {
  const schema = asSchema(createFrontendTemplateOutputTools().tools.submit_frontend_template.inputSchema).jsonSchema

  expect(schema.required).toContain("final_acceptance_mode")
  expect(schema.properties?.final_acceptance_mode).not.toHaveProperty("default")
})

test("submit_frontend_template tolerates missing review fields from provider tool calls", async () => {
  const kit = createFrontendTemplateOutputTools({ autoIteration: true })
  const submit = kit.tools.submit_frontend_template as any

  const out = await submit.execute({
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

test("submit_frontend_template normalizes markdown open questions", async () => {
  const kit = createFrontendTemplateOutputTools()
  const submit = kit.tools.submit_frontend_template as any

  await submit.execute({
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
        custom_fallback_reason: "not applicable",
      },
    ],
    material_inventory: "materials",
    visual_consistency_contract: "visual contract",
    ui_data_contract: "data contract",
    frontend_project: {
      status: "created",
      role: "source_baseline_input",
      project_root: "frontend-design-skeleton",
      source_package: "web-clone-source",
      entrypoints: ["README.md", "src/App.tsx", "src/styles.css"],
      generation_tool: "host-prepared:create_frontend_skeleton_project",
      notes: ["source baseline ready"],
    },
    template_iteration_notes: ["checked inventory"],
    completeness_review: "complete enough",
    open_questions: "- right toolbar capture ambiguity\n- exact 1600px max width",
  }, {})

  expect(kit.getCollector().final?.open_questions).toEqual([
    "right toolbar capture ambiguity",
    "exact 1600px max width",
  ])
})

test("submit_frontend_template rebuilds flattened frontend_project provider args", async () => {
  const kit = createFrontendTemplateOutputTools()
  const submit = kit.tools.submit_frontend_template as any

  await submit.execute({
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
    "frontend_project<arg_key>role": "source_baseline_input",
    "frontend_project<arg_key>project_root": "frontend-design-skeleton",
    "frontend_project<arg_key>source_package": "web-clone-source",
    "frontend_project<arg_key>entrypoints": "[\"README.md\",\"src/App.tsx\"]",
    "frontend_project<arg_key>generation_tool": "host-prepared:create_frontend_skeleton_project",
    "frontend_project<arg_key>notes": "[\"source skeleton ready\"]",
  }, {})

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
  expect(schema.properties?.frontend_project).toBeDefined()
  expect(schema.properties).not.toHaveProperty("fact_check_items")
})

test("submit_frontend_template renders compact structured fields into markdown handoff", async () => {
  const kit = createFrontendTemplateOutputTools()
  const submit = kit.tools.submit_frontend_template as any

  await submit.execute({
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
      { title: "Source layout", detail: "Build src/pages/MarketsPage.tsx from the source skeleton, semantic components, and preserved CSS sidecars.", source_refs: ["frontend-design-skeleton/src/App.tsx"] },
      { title: "Verification", detail: "Run visual diff against reference.png and source audit before reporting pass.", source_refs: ["web-clone-source/reference.png"] },
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
  expect(final?.component_inventory).toContain("Legacy compatibility summary only")
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
  expect(report).toContain("frontend-design-skeleton is source_baseline_input evidence only")
  expect(report).toContain("unfinished frontend_design work")
})

test("component reuse plan accepts provider naming and incomplete library hints without schema rejection", async () => {
  const submit = createFrontendTemplateOutputTools().tools.submit_frontend_template as any
  const base = {
    design_system: "custom dashboard",
    tech_stack: ["React"],
    final_acceptance_mode: "visual_baseline_allowed",
    frontend_template: "frontend template",
    fillable_modules: "fillable modules",
    component_inventory: "component inventory",
    material_inventory: "materials",
    visual_consistency_contract: "visual contract",
    ui_data_contract: "data contract",
    frontend_project: {
      status: "created",
      role: "source_baseline_input",
      project_root: "frontend-design-skeleton",
      source_package: "web-clone-source",
      entrypoints: ["README.md", "src/App.tsx", "src/styles.css"],
      generation_tool: "host-prepared:create_frontend_skeleton_project",
      notes: ["source baseline ready"],
    },
    template_iteration_notes: ["checked inventory"],
    completeness_review: "complete enough",
    reference_artifacts: [],
    open_questions: [],
  }

  const okWithProviderIds = await submit.execute({
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
        replacement_guard: "visual diff",
        custom_fallback_reason: "not applicable",
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
        replacement_guard: "visual diff",
      },
    ],
  }, {})

  expect(okWithProviderIds).toContain("OK")

  const secondSubmit = createFrontendTemplateOutputTools().tools.submit_frontend_template as any
  const ok = await submit.execute({
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
      },
    ],
  }, {})

  expect(ok).toContain("already submitted")
  const secondOk = await secondSubmit.execute({
    ...base,
    component_reuse_plan: [
      {
        family_id: "Table",
        name: "Table",
        observed_surface: "Data table",
        source_refs: [],
        implementation_strategy: "custom_fallback",
        reuse_source: "not found after inspecting src/components",
        mature_library_candidates: [],
        props_states: "rows and sort state",
        replacement_boundary: "table region",
        parity_guard: "visual diff",
      },
    ],
  }, {})
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
        custom_fallback_reason: "not applicable",
      },
    ],
    material_inventory: "materials",
    visual_consistency_contract: "visual contract",
    ui_data_contract: "data contract",
    frontend_project: {
      status: "created",
      role: "source_baseline_input",
      project_root: "frontend-design-skeleton",
      source_package: "web-clone-source",
      entrypoints: ["README.md", "src/App.tsx", "src/styles.css"],
      generation_tool: "host-prepared:create_frontend_skeleton_project",
      notes: ["source baseline ready"],
    },
    template_iteration_notes: ["checked inventory"],
    completeness_review: "complete enough",
    reference_artifacts: [],
    open_questions: [],
  }

  const okWithoutPlan = await submit.execute({
    ...base,
    baseline_replacement_plan: [],
  }, {})

  expect(okWithoutPlan).toContain("OK")
  expect(kit.getCollector().final?.component_reuse_plan.map((item) => item.family_id)).not.toContain("comp-source-page-baseline")
  expect(kit.getCollector().final?.baseline_replacement_plan).toHaveLength(0)
  expect(kit.getCollector().final?.quality_project_contract).not.toContain("source-page-baseline")

  const secondSubmit = await submit.execute({
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

  expect(secondSubmit).toContain("already submitted")
})

test("baseline replacement custom fallback reason is optional provider detail", async () => {
  const submit = createFrontendTemplateOutputTools().tools.submit_frontend_template as any

  const ok = await submit.execute({
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
        implementation_strategy: "custom_fallback",
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
        replacement_strategy: "custom_fallback",
        reuse_source: "not found after inspecting src/components",
        mature_library_candidates: [],
        deletion_rule: "Remove generated table HTML after the replacement is visually equivalent.",
        source_refs: ["web-clone-source/source-ir/content-model.json"],
        parity_guard: "Run visual diff and source audit.",
      },
    ],
    material_inventory: "materials",
    visual_consistency_contract: "visual contract",
    ui_data_contract: "data contract",
    template_iteration_notes: ["checked inventory"],
    completeness_review: "complete enough",
    reference_artifacts: [],
    open_questions: [],
  }, {})

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
