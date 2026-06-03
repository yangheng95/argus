import { describe, expect, test } from "bun:test"
import { buildResearchBriefFromDraft, createResearchOutputTools } from "../../src/research/output-tools"
import { researchRequestHash, validateResearchBriefIntegrity } from "../../src/research/schema"

function callTool(tools: Record<string, any>, name: string, input: unknown): Promise<string> {
  return tools[name].execute!(input as any, {} as any)
}

function validSubmit(overrides: Record<string, unknown> = {}) {
  return {
    scope: {
      user_goal: "Prepare PRD input",
      deliverable_type: "prd",
      audience: "product",
      explicit_non_goals: [],
      assumed_non_goals: [],
    },
    bundle: {
      full_markdown: "# Full research bundle",
      evidence_json: "{\"items\":[]}",
      citation_map_json: "{\"citations\":[]}",
    },
    summary: "Research summary.",
    evidence_index: [
      {
        id: "ev_1",
        kind: "web",
        pointer: "https://example.com",
        title: "Example",
        retrieved_at: "2026-05-31T00:00:00.000Z",
        reliability: "primary",
        excerpt: "A compact excerpt.",
        bundle_ref: "research-bundle.md#ev_1",
        volatile: false,
      },
    ],
    facts: [{ id: "fact_1", statement: "A fact.", evidence_ids: ["ev_1"] }],
    inferences: [{ id: "inf_1", inference: "An inference.", based_on_fact_ids: ["fact_1"], confidence: "medium" }],
    problem_statements: [{ id: "prob_1", statement: "A problem.", fact_ids: ["fact_1"] }],
    user_needs: [{ id: "need_1", need: "A need.", fact_ids: ["fact_1"] }],
    constraints: [{ id: "con_1", constraint: "A constraint.", fact_ids: ["fact_1"] }],
    document_outline: [{ id: "sec_1", title: "Section", purpose: "Purpose", evidence_ids: ["ev_1"] }],
    subpage_research_tasks: [],
    open_questions: [{ id: "oq_1", question: "A question?", blocking: false, related_fact_ids: ["fact_1"] }],
    fact_check_items: [],
    ...overrides,
  }
}

function validWebpageContract(overrides: Record<string, unknown> = {}) {
  return {
    source_url: "https://example.com/markets/world-economy/",
    reference_image_evidence_ids: ["ev_1"],
    functional_surfaces: [
      {
        id: "surface_economic_trends",
        title: "Economic trends",
        user_visible_behavior: "Shows an inflation map, GDP growth list, and economic metric cards.",
        required_interactions: ["Tab navigation remains selectable when evidence shows it."],
        evidence_ids: ["ev_1"],
      },
    ],
    visual_layout: [
      {
        id: "layout_desktop_economic_trends",
        viewport: "desktop",
        region: "Economic trends",
        layout_contract: "Inflation map and GDP growth table share the first row, with metric cards below.",
        spacing_and_alignment: "Cards align to the source grid and keep extracted section spacing.",
        evidence_ids: ["ev_1"],
      },
    ],
    style_requirements: [
      {
        id: "style_cards",
        token_or_selector: ".card-_bHcdE9E",
        requirement: "Use source-backed card border, radius, padding, and typography.",
        evidence_ids: ["ev_1"],
      },
    ],
    interaction_states: [
      {
        id: "state_tabs_selected",
        component: "Overview tab",
        state: "selected",
        behavior: "Selected tab is visually distinct and uses the source tab style.",
        evidence_ids: ["ev_1"],
      },
    ],
    data_content_inventory: [
      {
        id: "data_gdp_growth",
        surface: "GDP growth table",
        content_contract: "Rows include country, GDP growth, nominal GDP, unit, and flag/logo.",
        evidence_ids: ["ev_1"],
      },
    ],
    fidelity_acceptance: [
      {
        id: "accept_first_viewport",
        target: "Desktop first viewport",
        criterion: "Screenshot contains the source header, Economy overview title, inflation map, GDP growth table, and metric cards in the same visual order.",
        evidence_ids: ["ev_1"],
      },
    ],
    fidelity_risks: [
      {
        id: "risk_runtime_css",
        risk: "Runtime-generated CSS selector dependencies may not survive semantic reshaping.",
        impact: "Visual fidelity can degrade if component structure diverges from source evidence.",
        evidence_ids: ["ev_1"],
      },
    ],
    ...overrides,
  }
}

describe("research output tools", () => {
  test("submit_research_brief rejects orphan evidence references without finalizing", async () => {
    const kit = createResearchOutputTools()
    const result = await callTool(
      kit.tools,
      "submit_research_brief",
      validSubmit({ facts: [{ id: "fact_1", statement: "A fact.", evidence_ids: ["ev_missing"] }] }),
    )

    expect(result).toContain("failed semantic validation")
    expect(kit.getCollector().finalized).toBe(false)
    expect(kit.getCollector().draft).toBeUndefined()
  })

  test("submit_research_brief finalizes a valid compact brief and preserves fact-check items", async () => {
    const kit = createResearchOutputTools()
    const result = await callTool(
      kit.tools,
      "submit_research_brief",
      validSubmit({
        fact_check_items: [
          {
            claim: "Example API behavior is verified by the cited official documentation.",
            confidence: "medium",
            category: "api",
            source: "https://example.com",
          },
        ],
      }),
    )

    expect(result).toContain("PASS")
    expect(kit.getCollector().finalized).toBe(true)
    expect(kit.getCollector().fact_check_items).toHaveLength(1)
  })

  test("submit_research_brief accepts a source-backed webpage contract", async () => {
    const kit = createResearchOutputTools()
    const result = await callTool(
      kit.tools,
      "submit_research_brief",
      validSubmit({
        webpage_contract: validWebpageContract(),
      }),
    )

    expect(result).toContain("PASS")
    expect(result).toContain("webpage_contract=yes")
    expect(kit.getCollector().draft?.webpage_contract?.functional_surfaces[0]?.title).toBe("Economic trends")
    expect(kit.buildReport().detail).toContain("## Webpage Contract")
    expect(kit.buildReport().detail).toContain("functional_surfaces=1")
  })

  test("submit_research_brief rejects webpage contract references to unknown evidence", async () => {
    const kit = createResearchOutputTools()
    const result = await callTool(
      kit.tools,
      "submit_research_brief",
      validSubmit({
        webpage_contract: validWebpageContract({
          visual_layout: [
            {
              id: "layout_desktop_economic_trends",
              viewport: "desktop",
              region: "Economic trends",
              layout_contract: "Broken evidence reference.",
              spacing_and_alignment: "Broken evidence reference.",
              evidence_ids: ["ev_missing"],
            },
          ],
        }),
      }),
    )

    expect(result).toContain("failed semantic validation")
    expect(result).toContain("webpage_contract.visual_layout layout_desktop_economic_trends.evidence_ids")
    expect(kit.getCollector().finalized).toBe(false)
  })

  test("submit_research_brief accepts cited subpage research task candidates", async () => {
    const kit = createResearchOutputTools()
    const result = await callTool(
      kit.tools,
      "submit_research_brief",
      validSubmit({
        subpage_research_tasks: [
          {
            id: "subpage_1",
            parent_url: "https://example.com",
            url: "https://example.com/docs/api",
            title: "API reference",
            reason: "The parent page links to a detailed API surface that needs separate evidence.",
            suggested_focus: "Study the API reference as an independent source page.",
            priority: "high",
            evidence_ids: ["ev_1"],
          },
        ],
      }),
    )

    expect(result).toContain("PASS")
    expect(result).toContain("subpage_research_tasks=1")
    expect(kit.buildReport().detail).toContain("https://example.com/docs/api")
  })

  test("submit_research_brief rejects subpage task candidates with unknown evidence", async () => {
    const kit = createResearchOutputTools()
    const result = await callTool(
      kit.tools,
      "submit_research_brief",
      validSubmit({
        subpage_research_tasks: [
          {
            id: "subpage_1",
            parent_url: "https://example.com",
            url: "https://example.com/docs/api",
            title: "API reference",
            reason: "Needs independent evidence.",
            suggested_focus: "Study the API reference.",
            evidence_ids: ["ev_missing"],
          },
        ],
      }),
    )

    expect(result).toContain("failed semantic validation")
    expect(result).toContain("subpage_research_task subpage_1.evidence_ids")
    expect(kit.getCollector().finalized).toBe(false)
  })

  test("buildResearchBriefFromDraft computes source digest after schema defaults are applied", () => {
    const submit = validSubmit({
      evidence_index: [
        {
          id: "ev_1",
          kind: "web",
          pointer: "https://example.com",
          title: "Example",
          retrieved_at: "2026-05-31T00:00:00.000Z",
          reliability: "primary",
          excerpt: "A compact excerpt.",
          bundle_ref: "research-bundle.md#ev_1",
        },
      ],
    })
    const { fact_check_items: _factCheckItems, bundle, ...draft } = submit
    const brief = buildResearchBriefFromDraft({
      draft: { ...draft, bundle } as any,
      metadata: {
        research_session_id: "ses_research_digest",
        created_for_message_id: "msg_research_digest",
        request_hash: researchRequestHash("digest regression"),
        created_at: "2026-05-31T00:00:00.000Z",
      },
      bundlePaths: {
        full_markdown_path: ".opencorvus/runtime/tasks/t/research/s/research-bundle.md",
        evidence_json_path: ".opencorvus/runtime/tasks/t/research/s/evidence.json",
        citation_map_path: ".opencorvus/runtime/tasks/t/research/s/citation-map.json",
      },
    })

    expect(brief.evidence_index[0]?.volatile).toBe(false)
    expect(validateResearchBriefIntegrity(brief)).toBeUndefined()
  })
})
