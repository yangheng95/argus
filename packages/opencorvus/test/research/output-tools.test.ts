import { describe, expect, test } from "bun:test"
import {
  buildResearchBriefFromDraft,
  createResearchOutputTools,
  materializeResearchBundle,
  type ResearchCollector,
  ResearchFinalizeSchema,
  type ResearchToolCallReplay,
  researchBundleFromDraft,
} from "../../src/research/output-tools"
import { researchRequestHash, validateResearchBriefIntegrity } from "../../src/research/schema"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"

function callTool(tools: Record<string, any>, name: string, input: unknown): Promise<string> {
  return tools[name].execute!(input as any, {} as any)
}

async function registerMinimalBrief(kit = createResearchOutputTools()) {
  const { tools } = kit
  await callTool(tools, "update_research_scope", {
    user_goal: "Prepare PRD input",
    deliverable_type: "prd",
    audience: "product",
    explicit_non_goals: [],
    assumed_non_goals: [],
  })
  await callTool(tools, "update_research_summary", { summary: "Research summary." })
  await callTool(tools, "update_research_evidence", {
    id: "ev_1",
    kind: "web",
    pointer: "https://example.com",
    title: "Example",
    retrieved_at: "2026-05-31T00:00:00.000Z",
    reliability: "primary",
    excerpt: "A compact excerpt.",
    volatile: false,
  })
  await callTool(tools, "update_research_fact", { id: "fact_1", statement: "A fact.", evidence_ids: ["ev_1"] })
  await callTool(tools, "update_research_inference", {
    id: "inf_1",
    inference: "An inference.",
    based_on_fact_ids: ["fact_1"],
    confidence: "medium",
  })
  await callTool(tools, "update_research_problem", { id: "prob_1", statement: "A problem.", fact_ids: ["fact_1"] })
  await callTool(tools, "update_research_need", { id: "need_1", need: "A need.", fact_ids: ["fact_1"] })
  await callTool(tools, "update_research_constraint", {
    id: "con_1",
    constraint: "A constraint.",
    fact_ids: ["fact_1"],
  })
  await callTool(tools, "update_research_document_section", {
    id: "sec_1",
    title: "Section",
    purpose: "Purpose",
    evidence_ids: ["ev_1"],
  })
  await callTool(tools, "update_research_open_question", {
    id: "oq_1",
    question: "A question?",
    blocking: false,
    related_fact_ids: ["fact_1"],
  })
  await callTool(tools, "update_research_bundle_section", {
    title: "Evidence Index",
    evidence_ids: ["ev_1"],
    points: ['Quoted label: "Economy overview".'],
  })
  await callTool(tools, "update_research_evidence_note", {
    evidence_id: "ev_1",
    observations: ['The source says "GDP growth".'],
    artifact_refs: ["source-ir/content-model.json"],
  })
  await callTool(tools, "update_research_citation", {
    claim_id: "fact_1",
    evidence_ids: ["ev_1"],
    pointer: "research-bundle.md#evidence-index",
    usage: "Supports fact_1.",
  })
  return kit
}

async function registerWebpageContract(kit: ReturnType<typeof createResearchOutputTools>) {
  const { tools } = kit
  await callTool(tools, "update_webpage_contract_source", {
    source_url: "https://example.com/markets/world-economy/",
    reference_image_evidence_ids: [],
  })
  await callTool(tools, "update_webpage_functional_surface", {
    id: "surface_economic_trends",
    title: "Economic trends",
    user_visible_behavior: "Shows an inflation map, GDP growth list, and economic metric cards.",
    component_kind_hypothesis: "map, table/list, and metric card group",
    required_interactions: ["Tab navigation remains selectable when evidence shows it."],
    evidence_ids: ["ev_1"],
  })
  await callTool(tools, "update_webpage_visual_layout", {
    id: "layout_desktop_economic_trends",
    viewport: "desktop",
    region: "Economic trends",
    layout_contract: "Inflation map and GDP growth table share the first row, with metric cards below.",
    spacing_and_alignment: "Cards align to the source grid and keep extracted section spacing.",
    evidence_ids: ["ev_1"],
  })
  await callTool(tools, "update_webpage_style_requirement", {
    id: "style_cards",
    token_or_selector: ".card-_bHcdE9E",
    requirement: "Use source-backed card border, radius, padding, and typography.",
    evidence_ids: ["ev_1"],
  })
  await callTool(tools, "update_webpage_interaction_state", {
    id: "state_tabs_selected",
    component: "Overview tab",
    state: "selected",
    behavior: "Selected tab is visually distinct and uses the source tab style.",
    evidence_ids: ["ev_1"],
  })
  await callTool(tools, "update_webpage_data_inventory", {
    id: "data_gdp_growth",
    surface: "GDP growth table",
    content_contract: "Rows include country, GDP growth, nominal GDP, unit, and flag/logo.",
    evidence_ids: ["ev_1"],
  })
  await callTool(tools, "update_webpage_fidelity_acceptance", {
    id: "accept_first_viewport",
    target: "Desktop first viewport",
    criterion: "Screenshot contains source header, title, map, table, and cards in the same visual order.",
    evidence_ids: ["ev_1"],
  })
  await callTool(tools, "update_webpage_fidelity_risk", {
    id: "risk_runtime_css",
    risk: "Runtime-generated CSS selector dependencies may not survive semantic reshaping.",
    impact: "Visual fidelity can degrade if component structure diverges from source evidence.",
    evidence_ids: ["ev_1"],
  })
}

function replayCallsFromCollector(collector: ResearchCollector): ResearchToolCallReplay[] {
  const calls: ResearchToolCallReplay[] = []
  if (collector.scope) calls.push({ toolName: "update_research_scope", input: collector.scope })
  if (collector.summary) calls.push({ toolName: "update_research_summary", input: { summary: collector.summary } })
  for (const input of collector.evidence_index) calls.push({ toolName: "update_research_evidence", input })
  for (const input of collector.facts) calls.push({ toolName: "update_research_fact", input })
  for (const input of collector.inferences) calls.push({ toolName: "update_research_inference", input })
  for (const input of collector.problem_statements) calls.push({ toolName: "update_research_problem", input })
  for (const input of collector.user_needs) calls.push({ toolName: "update_research_need", input })
  for (const input of collector.constraints) calls.push({ toolName: "update_research_constraint", input })
  for (const input of collector.document_outline) calls.push({ toolName: "update_research_document_section", input })
  if (collector.webpage_contract_source) {
    calls.push({ toolName: "update_webpage_contract_source", input: collector.webpage_contract_source })
  }
  for (const input of collector.webpage_functional_surfaces) {
    calls.push({ toolName: "update_webpage_functional_surface", input })
  }
  for (const input of collector.webpage_visual_layout) calls.push({ toolName: "update_webpage_visual_layout", input })
  for (const input of collector.webpage_style_requirements) {
    calls.push({ toolName: "update_webpage_style_requirement", input })
  }
  for (const input of collector.webpage_interaction_states) {
    calls.push({ toolName: "update_webpage_interaction_state", input })
  }
  for (const input of collector.webpage_data_content_inventory) {
    calls.push({ toolName: "update_webpage_data_inventory", input })
  }
  for (const input of collector.webpage_fidelity_acceptance) {
    calls.push({ toolName: "update_webpage_fidelity_acceptance", input })
  }
  for (const input of collector.webpage_fidelity_risks) calls.push({ toolName: "update_webpage_fidelity_risk", input })
  for (const input of collector.subpage_research_tasks) calls.push({ toolName: "update_subpage_research_task", input })
  for (const input of collector.open_questions) calls.push({ toolName: "update_research_open_question", input })
  for (const input of collector.bundle.full_markdown_sections) {
    calls.push({ toolName: "update_research_bundle_section", input })
  }
  for (const input of collector.bundle.evidence_notes) calls.push({ toolName: "update_research_evidence_note", input })
  for (const input of collector.bundle.citation_map) calls.push({ toolName: "update_research_citation", input })
  return calls
}

describe("research output tools", () => {
  test("chunked registration finalizes a valid brief and preserves fact-check items", async () => {
    const kit = await registerMinimalBrief()
    const result = await callTool(kit.tools, "submit_research_brief", {
      final: true,
      fact_check_items: [
        {
          claim: "Example API behavior is verified by the cited official documentation.",
          confidence: "medium",
          category: "api",
          source: "https://example.com",
        },
      ],
    })

    expect(result).toContain("PASS")
    expect(kit.getCollector().finalized).toBe(true)
    expect(kit.getCollector().fact_check_items).toHaveLength(1)
    expect(kit.getCollector().draft?.evidence_index[0]?.bundle_ref).toBe("research-bundle.md#ev_1")
  })

  test("submit_research_brief no longer accepts the old giant payload shape", () => {
    const parsed = ResearchFinalizeSchema.safeParse({
      scope: { user_goal: "x", deliverable_type: "prd", audience: "product" },
      bundle: { full_markdown_sections: [] },
      final: true,
    })

    expect(parsed.success).toBe(false)
  })

  test("submit_research_brief rejects incomplete collectors without finalizing", async () => {
    const kit = createResearchOutputTools()
    await callTool(kit.tools, "update_research_summary", { summary: "Only a summary." })

    const result = await callTool(kit.tools, "submit_research_brief", { final: true })

    expect(result).toContain("MISSING_RESEARCH_RESULT")
    expect(result).toContain("update_research_scope")
    expect(result).toContain("update_research_bundle_section")
    expect(kit.getCollector().finalized).toBe(false)
    expect(kit.getCollector().draft).toBeUndefined()
  })

  test("inspect_research_result_status reports missing update calls without finalizing", async () => {
    const kit = createResearchOutputTools({ expectedWebpageSourceUrl: "https://example.com/markets/world-economy/" })
    await callTool(kit.tools, "update_research_summary", { summary: "Only a summary." })

    const status = await callTool(kit.tools, "inspect_research_result_status", {})

    expect(status).toContain("RESEARCH_RESULT_STATUS: incomplete")
    expect(status).toContain("update_research_scope")
    expect(status).toContain("update_webpage_contract_source")
    expect(kit.getCollector().finalized).toBe(false)
  })

  test("isReadyToSubmit follows required chunk coverage and semantic validation state", async () => {
    const kit = createResearchOutputTools({ expectedWebpageSourceUrl: "https://example.com/markets/world-economy/" })
    expect(kit.isReadyToSubmit()).toBe(false)

    await registerMinimalBrief(kit)
    expect(kit.isReadyToSubmit()).toBe(false)

    await registerWebpageContract(kit)
    expect(kit.isReadyToSubmit()).toBe(true)

    await callTool(kit.tools, "update_research_bundle_section", {
      title: "Evidence Index",
      evidence_ids: ["ev_missing"],
      points: ['Quoted label: "Economy overview".'],
    })
    expect(kit.isReadyToSubmit()).toBe(true)

    const invalidSubmit = await callTool(kit.tools, "submit_research_brief", { final: true })
    expect(invalidSubmit).toContain("failed semantic validation")
    expect(kit.isReadyToSubmit()).toBe(false)

    await callTool(kit.tools, "update_research_bundle_section", {
      title: "Evidence Index",
      evidence_ids: ["ev_1"],
      points: ['Quoted label: "Economy overview".'],
    })
    expect(kit.isReadyToSubmit()).toBe(true)
  })

  test("replayUpdateToolCalls hydrates a fresh continuation collector from completed update tool inputs", async () => {
    const original = await registerMinimalBrief(
      createResearchOutputTools({ expectedWebpageSourceUrl: "https://example.com/markets/world-economy/" }),
    )
    await registerWebpageContract(original)
    expect(original.isReadyToSubmit()).toBe(true)

    const fresh = createResearchOutputTools({ expectedWebpageSourceUrl: "https://example.com/markets/world-economy/" })
    expect(fresh.isReadyToSubmit()).toBe(false)

    const replayed = await fresh.replayUpdateToolCalls([
      ...replayCallsFromCollector(original.getCollector()),
      { toolName: "inspect_research_result_status", input: {} },
      { toolName: "submit_research_brief", input: { final: true } },
      { toolName: "skill", input: { command: "irrelevant utility tool" } },
    ])

    expect(replayed).toBe(replayCallsFromCollector(original.getCollector()).length)
    expect(fresh.getCollector().webpage_contract_source?.source_url).toBe(
      "https://example.com/markets/world-economy/",
    )
    expect(fresh.getCollector().webpage_visual_layout[0]?.id).toBe("layout_desktop_economic_trends")
    expect(fresh.getCollector().finalized).toBe(false)
    expect(fresh.isReadyToSubmit()).toBe(true)
  })

  test("fact-reference update tools reject unknown fact ids before final submit", async () => {
    const cases = [
      {
        tool: "update_research_inference",
        input: { id: "inf_bad", inference: "An inference.", based_on_fact_ids: ["risk_api_illusion", "fact_1"] },
        collectorKey: "inferences",
      },
      {
        tool: "update_research_problem",
        input: { id: "prob_bad", statement: "A problem with stale risk ids.", fact_ids: ["risk_api_illusion", "fact_1"] },
        collectorKey: "problem_statements",
      },
      {
        tool: "update_research_need",
        input: { id: "need_bad", need: "A need with stale risk ids.", fact_ids: ["risk_api_illusion", "fact_1"] },
        collectorKey: "user_needs",
      },
      {
        tool: "update_research_constraint",
        input: { id: "constraint_bad", constraint: "A constraint.", fact_ids: ["risk_api_illusion", "fact_1"] },
        collectorKey: "constraints",
      },
      {
        tool: "update_research_open_question",
        input: { id: "question_bad", question: "An open question.", related_fact_ids: ["risk_api_illusion", "fact_1"] },
        collectorKey: "open_questions",
      },
    ] as const

    for (const item of cases) {
      const kit = createResearchOutputTools()
      await callTool(kit.tools, "update_research_fact", {
        id: "fact_1",
        statement: "A registered fact.",
        evidence_ids: ["ev_1"],
      })

      const result = await callTool(kit.tools, item.tool, item.input)

      expect(result).toContain("references unknown fact id")
      expect(result).toContain("risk_api_illusion")
      expect(result).toContain("known fact ids: fact_1")
      expect(result).toContain("Collector unchanged")
      expect(kit.getCollector()[item.collectorKey]).toEqual([])
    }
  })

  test("researchBundleFromDraft materializes registered structured notes with quotes", async () => {
    const kit = await registerMinimalBrief()
    await callTool(kit.tools, "submit_research_brief", { final: true })
    const draft = kit.getCollector().draft
    if (!draft) throw new Error("draft missing")

    const materialized = researchBundleFromDraft(draft)

    expect(materialized.full_markdown).toContain("## Evidence Index")
    expect(materialized.full_markdown).toContain('"Economy overview"')
    expect(JSON.parse(materialized.evidence_json).evidence_notes[0].observations[0]).toContain('"GDP growth"')
    expect(JSON.parse(materialized.citation_map_json).citations[0].claim_id).toBe("fact_1")
    expect(materializeResearchBundle(draft.bundle)).toEqual(materialized)
  })

  test("bundle registration rejects embedded newlines before submit", () => {
    const kit = createResearchOutputTools()
    const parsed = kit.tools.update_research_bundle_section.inputSchema.safeParse({
      title: "Evidence Index",
      evidence_ids: ["ev_1"],
      points: ["This point contains an embedded newline\ninstead of a separate array item."],
    })

    expect(parsed.success).toBe(false)
  })

  test("chunked webpage contract accepts missing visual reference captures", async () => {
    const kit = await registerMinimalBrief()
    await registerWebpageContract(kit)

    const result = await callTool(kit.tools, "submit_research_brief", { final: true })

    expect(result).toContain("PASS")
    expect(kit.getCollector().draft?.webpage_contract?.reference_image_evidence_ids).toEqual([])
    expect(kit.getCollector().draft?.webpage_contract?.functional_surfaces[0]?.title).toBe("Economic trends")
    expect(kit.buildReport().detail).toContain("functional_surfaces=1")
  })

  test("webpage contract source must match the prepared frontend research source URL", async () => {
    const kit = await registerMinimalBrief(
      createResearchOutputTools({ expectedWebpageSourceUrl: "https://example.com/markets/world-economy/" }),
    )

    const result = await callTool(kit.tools, "update_webpage_contract_source", {
      source_url: "https://example.com/other-page/",
      reference_image_evidence_ids: [],
    })

    expect(result).toContain("must match the prepared frontend_research source URL")
    expect(result).toContain("https://example.com/markets/world-economy/")
    expect(kit.getCollector().webpage_contract_source).toBeUndefined()
  })

  test("webpage contract source rejects non-http URLs", async () => {
    const kit = await registerMinimalBrief()

    await expect(
      callTool(kit.tools, "update_webpage_contract_source", {
        source_url: "file:///tmp/reference.html",
        reference_image_evidence_ids: [],
      }),
    ).rejects.toThrow("source_url must be an HTTP(S) webpage URL")

    expect(kit.getCollector().webpage_contract_source).toBeUndefined()
  })

  test("webpage contract source rejects unknown fields instead of stripping source contract drift", async () => {
    const kit = await registerMinimalBrief()

    await expect(
      callTool(kit.tools, "update_webpage_contract_source", {
        source_url: "https://example.com/markets/world-economy/",
        sourceUrl: "https://example.com/other-page/",
        reference_image_evidence_ids: [],
      }),
    ).rejects.toThrow("Unrecognized key")

    expect(kit.getCollector().webpage_contract_source).toBeUndefined()
  })

  test("submit_research_brief rejects webpage contract references to unknown evidence", async () => {
    const kit = await registerMinimalBrief()
    await registerWebpageContract(kit)
    await callTool(kit.tools, "update_webpage_visual_layout", {
      id: "layout_desktop_economic_trends",
      viewport: "desktop",
      region: "Economic trends",
      layout_contract: "Broken evidence reference.",
      spacing_and_alignment: "Broken evidence reference.",
      evidence_ids: ["ev_missing"],
    })

    const result = await callTool(kit.tools, "submit_research_brief", { final: true })

    expect(result).toContain("failed semantic validation")
    expect(result).toContain("webpage_contract.visual_layout layout_desktop_economic_trends.evidence_ids")
    expect(kit.getCollector().finalized).toBe(false)
  })

  test("submit_research_brief rejects cited subpage tasks with unknown evidence", async () => {
    const kit = await registerMinimalBrief()
    await callTool(kit.tools, "update_subpage_research_task", {
      id: "subpage_1",
      parent_url: "https://example.com",
      url: "https://example.com/docs/api",
      title: "API reference",
      reason: "Needs independent evidence.",
      suggested_focus: "Study the API reference.",
      evidence_ids: ["ev_missing"],
    })

    const result = await callTool(kit.tools, "submit_research_brief", { final: true })

    expect(result).toContain("failed semantic validation")
    expect(result).toContain("subpage_research_task subpage_1.evidence_ids")
  })

  test("buildResearchBriefFromDraft computes source digest after schema defaults are applied", async () => {
    const kit = await registerMinimalBrief()
    await callTool(kit.tools, "submit_research_brief", { final: true })
    const draft = kit.getCollector().draft
    if (!draft) throw new Error("draft missing")

    const bundleRoot = ProjectRuntimePaths.deepResearchPaths(
      "",
      "tsk_research_digest",
      "ses_research_digest",
    ).relativeDir
    const brief = buildResearchBriefFromDraft({
      draft,
      metadata: {
        research_session_id: "ses_research_digest",
        created_for_message_id: "msg_research_digest",
        request_hash: researchRequestHash("digest regression"),
        created_at: "2026-05-31T00:00:00.000Z",
      },
      bundlePaths: {
        full_markdown_path: `${bundleRoot}/research-bundle.md`,
        evidence_json_path: `${bundleRoot}/evidence.json`,
        citation_map_path: `${bundleRoot}/citation-map.json`,
      },
    })

    expect(brief.evidence_index[0]?.volatile).toBe(false)
    expect(validateResearchBriefIntegrity(brief)).toBeUndefined()
  })
})
