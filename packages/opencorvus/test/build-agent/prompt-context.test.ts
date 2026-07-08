import { describe, expect, test } from "bun:test"
import path from "node:path"
import { buildRetryFeedbackPrompt, buildUserPrompt } from "../../src/build/agent"
import { textContextPacket, type AgentContextPacket } from "../../src/agent/context-packet"
import {
  buildIntegrityBlockingFingerprintsFromContextPackets,
  buildRepairContractStructuredPart,
  buildVisualHandoffStructuredPart,
  type BuildVisualHandoffContextData,
} from "../../src/build/prompt-context"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"

const repoRoot = path.resolve(import.meta.dir, "../../../..")
const buildAgentSourcePath = path.join(repoRoot, "packages/opencorvus/src/build/agent.ts")

function packet(
  source: string,
  title: string,
  body: string,
  visualHandoff?: BuildVisualHandoffContextData,
): AgentContextPacket {
  const result = textContextPacket({
    id: `${source}-test-context`,
    title,
    source,
    scope: "task",
    body,
  })
  if (!result) throw new Error(`empty packet fixture for ${source}`)
  const structured = visualHandoff ? buildVisualHandoffStructuredPart(visualHandoff) : undefined
  return structured ? { ...result, parts: [...result.parts, structured] } : result
}

function packets(input: {
  acceptance?: string
  visualQaBody?: string
  integrity?: string
  orchestrator?: string
  retry?: string
  frontendDesignBody?: string
  frontendDesignVisualHandoff?: BuildVisualHandoffContextData
  frontendResearch?: string
}): AgentContextPacket[] {
  return [
    input.frontendResearch
      ? packet("frontend_research", "Frontend Research Build Pointers", input.frontendResearch)
      : undefined,
    input.frontendDesignBody
      ? packet(
          "frontend_design",
          "Frontend Design Handoff",
          input.frontendDesignBody,
          input.frontendDesignVisualHandoff ?? { visualReference: true },
        )
      : undefined,
    input.integrity ? packet("integrity", "Integrity Rework Evidence", input.integrity) : undefined,
    input.orchestrator ? packet("orchestrator", "Current Orchestrator Build Guidance", input.orchestrator) : undefined,
    input.retry ? packet("retry", "Prior Build Retry Evidence", input.retry) : undefined,
    input.visualQaBody ? packet("visual_qa", "Visual QA Repair Evidence", input.visualQaBody) : undefined,
    input.acceptance ? packet("acceptance", "Acceptance Repair Evidence", input.acceptance) : undefined,
  ].filter((item): item is AgentContextPacket => Boolean(item))
}

describe("build agent prompt context", () => {
  test("build agent text does not advertise Architect re-sizing as generic follow-up", async () => {
    const source = await Bun.file(buildAgentSourcePath).text()

    expect(source).not.toContain("Architect re-sizing")
    expect(source).toContain("Architect structural re-entry is only valid when durable evidence names an invalid persisted architect artifact")
    expect(source).not.toContain("Before reporting success")
  })

  test("request-path build receives canonical acceptance feedback", () => {
    const prompt = buildUserPrompt(
      {
        kind: "request",
        text: "Fix the integrated calculator deliverable.",
      },
      {
        contextPackets: packets({
          acceptance:
            "Acceptance review rejected the integrated deliverable.\n" +
            "Manifest evidence failures:\n" +
            "- [check] review:contract_audit status=failed: missing calculator contract",
        }),
      },
    )

    expect(prompt).toContain("## Agent Context Packets")
    expect(prompt).toContain("# Acceptance Repair Evidence")
    expect(prompt).toContain("source: acceptance")
    expect(prompt).toContain("review:contract_audit")
    expect(prompt).not.toContain("Visual Quality Assurance (QA)")
    expect(prompt).not.toContain("problem_dom_regions")
    expect(prompt).not.toContain("Canonical acceptance feedback packet")
    expect(prompt.indexOf("# Acceptance Repair Evidence")).toBeLessThan(prompt.indexOf("# Request"))
  })

  test("request-path build receives failed Visual QA feedback as a first-class repair overlay", () => {
    const prompt = buildUserPrompt(
      {
        kind: "request",
        text: "Repair the page after visual QA.",
      },
      {
        contextPackets: packets({
          visualQaBody:
            "Latest failed Visual QA implementation repair evidence.\n" +
            "production_blockers: 1\n" +
            "problem_dom_regions: 1\n" +
            "- dom-hero-tabs region=hero navigation boundary\n" +
            '  locator: main [data-testid="hero-tabs"]\n' +
            "  computed_style: display=flex; overflow=hidden; margin-top=-32px\n" +
            "  annotated_evidence_refs: /attachment/proj/dom-hero-tabs.annotated.png\n" +
            "  code_search_terms: hero-tabs, market-hero, is-clipped",
        }),
      },
    )

    expect(prompt).toContain("# Visual QA Repair Evidence")
    expect(prompt).toContain("source: visual_qa")
    expect(prompt).toContain("problem_dom_regions")
    expect(prompt).toContain("annotated_evidence_refs")
    expect(prompt).toContain("consumed_visual_qa_annotation_refs")
    expect(prompt).toContain("consumed_visual_feedback_comparison_refs")
    expect(prompt).toContain("consumed_visual_qa_diagnostic_refs")
    expect(prompt).toContain('locator: main [data-testid="hero-tabs"]')
    expect(prompt).toContain("/attachment/proj/dom-hero-tabs.annotated.png")
    expect(prompt).toContain("code_search_terms: hero-tabs, market-hero, is-clipped")
    expect(prompt.indexOf("# Visual QA Repair Evidence")).toBeLessThan(prompt.indexOf("# Request"))
    expect(prompt).not.toContain("# Acceptance Repair Evidence")
  })

  test("goal-path build receives canonical acceptance feedback through context packets", () => {
    const prompt = buildUserPrompt(
      {
        kind: "goal",
        id: "gol_calc",
        title: "Calculator UI",
        objective: "Build a scientific calculator UI.",
        requirement_ids: [],
        acceptance_specs: ["calculator renders"],
        owned_paths: ["src/App.tsx"],
        depends_on: [],
      },
      { contextPackets: packets({ acceptance: "Scoped acceptance rejection: contract_audit_failure." }) },
    )

    expect(prompt).toContain("# Acceptance Repair Evidence")
    expect(prompt).toContain("contract_audit_failure")
    expect(prompt).not.toContain("Raw verdict artifact JSON")
    expect(prompt.indexOf("Scoped acceptance rejection")).toBeLessThan(prompt.indexOf("# Goal: Calculator UI"))
  })

  test("goal-path build receives Visual QA feedback separately from acceptance feedback", () => {
    const prompt = buildUserPrompt(
      {
        kind: "goal",
        id: "gol_market_tabs",
        title: "Market tabs",
        objective: "Repair the market tabs visual structure.",
        requirement_ids: [],
        acceptance_specs: ["tabs match visual reference"],
        owned_paths: ["src/components/MarketTabs.tsx"],
        depends_on: [],
      },
      {
        contextPackets: packets({
          visualQaBody:
            "Latest failed Visual QA implementation repair evidence.\n" +
            "Production blockers:\n" +
            "- blocker-tabs region=market tabs required_correction=Restore tab spacing evidence_refs=browser_preview_evidence:tabs-reference-comparison\n" +
            "Problem DOM Regions:\n" +
            "- dom-tabs region=market tabs\n" +
            "  code_search_terms: MarketTabs, tab-row",
          acceptance: "Scoped acceptance rejection: visual reference artifact missing.",
        }),
      },
    )

    expect(prompt).toContain("# Visual QA Repair Evidence")
    expect(prompt).toContain("blocker-tabs")
    expect(prompt).toContain("code_search_terms: MarketTabs, tab-row")
    expect(prompt).toContain("# Acceptance Repair Evidence")
    expect(prompt).toContain("visual reference artifact missing")
    expect(prompt.indexOf("# Visual QA Repair Evidence")).toBeLessThan(prompt.indexOf("# Acceptance Repair Evidence"))
    expect(prompt.indexOf("# Acceptance Repair Evidence")).toBeLessThan(prompt.indexOf("# Goal: Market tabs"))
  })

  test("goal-path renders orchestrator guidance and retry evidence as context packets while preserving the goal contract", () => {
    const prompt = buildUserPrompt(
      {
        kind: "goal",
        id: "gol_chat_ui",
        title: "聊天UI组件",
        objective: "Build the chat UI components per Gemini design.",
        requirement_ids: [],
        acceptance_specs: ["MessageList renders streaming messages"],
        owned_paths: ["src/components"],
        depends_on: [],
      },
      {
        contextPackets: packets({
          orchestrator:
            "Previous attempt did not call report_build_result before turn ended. This attempt MUST call it exactly once after verification.",
          retry: "## Prior Attempt Failed — Read This Before Implementing\n- coordinator note: see retry context.",
        }),
      },
    )

    expect(prompt).toContain("# Current Orchestrator Build Guidance")
    expect(prompt).toContain("Previous attempt did not call report_build_result")
    expect(prompt).toContain("MUST call it exactly once")
    expect(prompt).toContain("# Prior Build Retry Evidence")
    expect(prompt.indexOf("# Current Orchestrator Build Guidance")).toBeLessThan(
      prompt.indexOf("# Prior Build Retry Evidence"),
    )
    expect(prompt.indexOf("## Prior Attempt Failed")).toBeLessThan(prompt.indexOf("# Goal: 聊天UI组件"))

    // The architect-committed objective is preserved verbatim: current-turn
    // guidance is additive context and does not replace it (the bug spec §5.2 fixes).
    expect(prompt).toContain("**Objective**: Build the chat UI components per Gemini design.")
  })

  test("goal-path renders persistent integrity findings before retry packet evidence", () => {
    const prompt = buildUserPrompt(
      {
        kind: "goal",
        id: "gol_settings",
        title: "Settings repair",
        objective: "Repair settings validation.",
        requirement_ids: [],
        acceptance_specs: ["settings are validated"],
        owned_paths: ["src/services/storage.ts"],
        depends_on: [],
      },
      {
        contextPackets: packets({
          integrity:
            "## Persistent Integrity Findings (Treat Blocking Items As Must-Fix)\n\n" +
            "- **BF-settings**: getSettings does not validate persisted settings.",
          retry: "Focus on the storage service.",
        }),
      },
    )

    expect(prompt).toContain("## Persistent Integrity Findings")
    expect(prompt).toContain("BF-settings")
    expect(prompt.indexOf("## Persistent Integrity Findings")).toBeLessThan(
      prompt.indexOf("# Prior Build Retry Evidence"),
    )
    expect(prompt.indexOf("# Prior Build Retry Evidence")).toBeLessThan(
      prompt.indexOf("# Goal: Settings repair"),
    )
  })

  test("goal-path build treats active requirements as a PRD coverage contract", () => {
    const prompt = buildUserPrompt(
      {
        kind: "goal",
        id: "gol_replica_tabs",
        title: "Replica tabs",
        objective: "Implement the floating tab content region.",
        requirement_ids: ["REQ-12"],
        acceptance_specs: ["floating tab region works"],
        owned_paths: ["src/components/tabs"],
        depends_on: [],
      },
      {
        requirements: [
          {
            id: "REQ-12",
            type: "explicit",
            description: "When the page scrolls down, a floating tab region switches visible economic content.",
            acceptance: "Runtime verification shows the floating tabs and switched content.",
            non_goals: "",
            evidence_refs: ["fr-interaction-scroll-tabs"],
          },
        ],
      },
    )

    expect(prompt).toContain("## Requirements / PRD Coverage Contract")
    expect(prompt).toContain("Read this before editing")
    expect(prompt).toContain("active REQ-N rows are the implementation contract")
    expect(prompt).toContain("map each requirement that touches your goal/request")
    expect(prompt).toContain("Do not treat PRD/research/design material as optional background")
    expect(prompt).toContain(
      "read the PRD/frontend_design material and any frontend_research investigation packets in page chunks",
    )
    expect(prompt).toContain("identify the component kind for each chunk")
    expect(prompt).toContain(
      "All visible content must be componentized and fed by props, data modules, fixtures, or API adapters",
    )
    expect(prompt).toContain("instead of hardcoded directly into page wrappers, generated SVG, or one-off JSX literals")
    expect(prompt).toContain("Charts, maps, heatmaps, geographic visualizations")
    expect(prompt).toContain("Do not replace a chart/map/heatmap with a flat SVG/image/decorative vector")
    expect(prompt).toContain("Weight the sources accordingly")
    expect(prompt).toContain("drive roughly 70% of implementation decisions")
    expect(prompt).toContain("supplies roughly 30% style, geometry, CSS, assets, and pixel-consistency support")
    expect(prompt).toContain("Frontend_research packets are coverage and investigation prompts")
    expect(prompt).toContain("REQ-12")
    expect(prompt).toContain("**Requirement IDs**: REQ-12")
    expect(prompt).toContain("fr-interaction-scroll-tabs")
    expect(prompt).toContain("## Terminal Report Contract")
    expect(prompt).toContain("contract_restatement")
    expect(prompt).toContain("followup_workload_guidance")
    expect(prompt).toContain("durable evidence names an invalid persisted architect artifact")
    expect(prompt).not.toContain("Architect re-sizing")
    expect(prompt).not.toContain("Before reporting success")
    expect(prompt).toContain("Weak follow-up models")
    expect(prompt.indexOf("## Requirements / PRD Coverage Contract")).toBeLessThan(
      prompt.indexOf("# Goal: Replica tabs"),
    )
  })

  test("direct build also receives active requirements when present", () => {
    const prompt = buildUserPrompt(
      {
        kind: "request",
        text: "Continue the webpage replica implementation.",
      },
      {
        requirements: [
          {
            id: "REQ-3",
            type: "implicit",
            description: "The replica must preserve the original page layout and interactions.",
            acceptance: "Visual and interaction checks pass.",
            non_goals: "",
          },
        ],
      },
    )

    expect(prompt).toContain("## Requirements / PRD Coverage Contract")
    expect(prompt).toContain("This direct build path still must honor the active requirements")
    expect(prompt).toContain("REQ-3")
    expect(prompt).toContain("## Terminal Report Contract")
    expect(prompt).toContain("detailed restatement of the effective req/goal contract")
    expect(prompt).toContain("where task complexity may still be hidden")
    expect(prompt).toContain("durable evidence names an invalid persisted architect artifact")
    expect(prompt).not.toContain("Architect re-sizing")
    expect(prompt).not.toContain("Before reporting success")
    expect(prompt.indexOf("## Requirements / PRD Coverage Contract")).toBeLessThan(prompt.indexOf("# Request"))
  })

  test("request-path renders orchestrator guidance as a context packet", () => {
    const prompt = buildUserPrompt(
      {
        kind: "request",
        text: "Implement the calculator.",
      },
      {
        contextPackets: packets({
          acceptance: "Raw verdict JSON.",
          orchestrator: "Re-run after fixing the missing terminal tool call.",
        }),
      },
    )

    expect(prompt).toContain("# Current Orchestrator Build Guidance")
    expect(prompt).toContain("Re-run after fixing the missing terminal tool call.")
    expect(prompt.indexOf("# Acceptance Repair Evidence")).toBeLessThan(prompt.indexOf("# Request"))
    expect(prompt.indexOf("# Current Orchestrator Build Guidance")).toBeLessThan(prompt.indexOf("# Request"))
  })

  test("request-path renders persistent integrity findings before request delegation", () => {
    const prompt = buildUserPrompt(
      {
        kind: "request",
        text: "Repair the direct build after integrity review.",
      },
      {
        contextPackets: packets({
          integrity:
            "## Persistent Integrity Findings (Treat Blocking Items As Must-Fix)\n\n" +
            "- **BF-direct**: direct build missed required validation.",
          retry: "Previous build failed.",
        }),
      },
    )

    expect(prompt).toContain("## Persistent Integrity Findings")
    expect(prompt).toContain("BF-direct")
    expect(prompt.indexOf("## Persistent Integrity Findings")).toBeLessThan(prompt.indexOf("# Prior Build Retry Evidence"))
    expect(prompt.indexOf("## Persistent Integrity Findings")).toBeLessThan(prompt.indexOf("# Request"))
  })

  test("same-session retry prompt renders only persisted failure facts", () => {
    const prompt = buildRetryFeedbackPrompt(
      {
        kind: "request",
        text: "Repair the direct build after integrity review.",
      },
      {
        contextPackets: packets({
          retry: "Prior attempt failed.",
          integrity:
            "## Persistent Integrity Findings (Treat Blocking Items As Must-Fix)\n\n" +
            "- **BF-retry**: retry still lacks storage validation.",
          visualQaBody: "Latest failed Visual QA implementation repair evidence.\nproblem_dom_regions: 1",
          acceptance: "Acceptance rejected.",
        }),
      },
    )

    expect(prompt).toContain("Prior attempt failed.")
    expect(prompt).toContain("## Persistent Integrity Findings")
    expect(prompt).toContain("BF-retry")
    expect(prompt).toContain("Latest failed Visual QA implementation repair evidence")
    expect(prompt).toContain("problem_dom_regions: 1")
    expect(prompt).toContain("Acceptance rejected.")
    expect(prompt.indexOf("## Persistent Integrity Findings")).toBeLessThan(prompt.indexOf("Prior attempt failed."))
    expect(prompt.indexOf("## Persistent Integrity Findings")).toBeLessThan(
      prompt.indexOf("Latest failed Visual QA implementation repair evidence"),
    )
    expect(prompt.indexOf("Latest failed Visual QA implementation repair evidence")).toBeLessThan(
      prompt.indexOf("Acceptance rejected."),
    )
    expect(prompt).not.toContain("## Task-Specific Build Overlays")
    expect(prompt).not.toContain("## Prior Attempt Failure Facts")
    expect(prompt).not.toContain("## Visual QA Repair Overlay")
    expect(prompt).not.toContain("## Acceptance Repair Overlay")
    expect(prompt).not.toContain("## Required Fix")
    expect(prompt).not.toContain("## Instructions")
    expect(prompt).not.toContain("Restate the detailed req/goal contract")
    expect(prompt).not.toContain("workload may still be underestimated")
  })

  test("request-path rejects ad-hoc exploration without a concrete deliverable", () => {
    const prompt = buildUserPrompt(
      {
        kind: "request",
        text: "请做探索性分析，不要生成任何代码。",
      },
      {},
    )

    expect(prompt).toContain("concrete deliverables such as investigation reports")
    expect(prompt).toContain("Build is the wrong stage")
    expect(prompt).not.toContain(["exploration", "investigation", "or analysis"].join(", "))
    expect(prompt).not.toContain("skip commit / merge_back")
    expect(prompt).not.toContain('status="passed"')
    expect(prompt).not.toContain("files_changed: []")
  })

  test("request-path accepts explicit investigation report deliverables", () => {
    const prompt = buildUserPrompt({
      kind: "request",
      text: "Produce an investigation report for the referenced webpage layout.",
    })

    expect(prompt).toContain("concrete deliverables such as investigation reports")
    expect(prompt).toContain("Product Requirements Documents (PRDs), research briefs, audits")
    expect(prompt).toContain("Build is the wrong stage")
  })

  test("private retry guidance sections are not rendered outside context packets", () => {
    const baseTarget = {
      kind: "goal" as const,
      id: "gol_x",
      title: "X",
      objective: "Build X.",
      requirement_ids: [],
      acceptance_specs: [],
      owned_paths: [],
      depends_on: [],
    }
    expect(buildUserPrompt(baseTarget, {})).not.toContain("## Retry Guidance From Orchestrator")
    expect(buildUserPrompt(baseTarget, { contextPackets: packets({ retry: "Retry through packet." }) })).not.toContain(
      "## Retry Guidance From Orchestrator",
    )
    expect(buildUserPrompt(baseTarget, { contextPackets: [] })).not.toContain(
      "## Persistent Integrity Findings",
    )
  })

  test("goal-path build restates 1:1 fidelity when visual contract exists", () => {
    const prompt = buildUserPrompt(
      {
        kind: "goal",
        id: "gol_visual",
        title: "Replica hero",
        objective: "Rebuild the referenced hero section.",
        requirement_ids: [],
        acceptance_specs: ["hero matches reference"],
        owned_paths: ["src/App.tsx"],
        depends_on: [],
      },
      {
        contextPackets: packets({
          frontendDesignBody:
            "Visual contract: restore the relevant subset 1:1 as closely as the stack allows.\nHero layout: Two-column hero with exact spacing.",
        }),
      },
    )

    expect(prompt).toContain("restore the relevant subset 1:1 as closely as the stack allows")
    expect(prompt).toContain("# Frontend Design Handoff")
    expect(prompt).toContain("**Reference Fidelity**")
    expect(prompt).toContain("Do not approximate, redesign, or invent missing evidence")
  })

  test("goal-path build receives source, reference, and assembly fidelity coverage", () => {
    const prompt = buildUserPrompt(
      {
        kind: "goal",
        id: "gol_visual",
        title: "Replica hero",
        objective: "Rebuild the referenced hero section with the existing app shell.",
        requirement_ids: [],
        acceptance_specs: ["hero matches reference"],
        owned_paths: ["src/App.tsx"],
        depends_on: [],
      },
      {
        fidelity: {
          sourceCoverage: [
            {
              id: "src-app-shell",
              paths: ["src/App.tsx"],
              goal_ids: ["gol_visual"],
              action: "modify",
              rationale: "This goal must adapt the existing app shell rather than bypass it.",
            },
          ],
          referenceCoverage: [
            {
              id: "ref-hero",
              surface: "hero",
              goal_ids: ["gol_visual"],
              visual_spec_ids: ["vis-hero"],
              reference_regions: [
                {
                  reference_region_key: "hero@desktop",
                  source_reference_artifact:
                    ".opencorvus/r/t/tsk_demo/fd/visual-region-bindings/page/01-hero__src1200x3000__x0-y0-w1200-h640.png",
                  binding_manifest_artifact: "docs/visual-region-binding.json",
                  source_bbox: { x: 0, y: 0, width: 1200, height: 640 },
                  crop_intent: "full-region",
                },
              ],
              expectation: "Restore the hero 1:1 from the reference.",
            },
          ],
          assemblyOwners: [
            {
              surface: "final-deliverable",
              goal_id: "gol_visual",
              rationale: "This goal owns final stitching for the deliverable shell.",
            },
          ],
        },
      } as any,
    )

    expect(prompt).toContain("## Source Coverage Contract")
    expect(prompt).toContain("src/App.tsx")
    expect(prompt).toContain("## Reference Coverage Contract")
    expect(prompt).toContain("visual_specs=vis-hero")
    expect(prompt).toContain("reference_region=hero@desktop")
    expect(prompt).toContain("crop=.opencorvus/r/t/tsk_demo/fd/visual-region-bindings/page/01-hero")
    expect(prompt).toContain("bbox=x:0,y:0,w:1200,h:640")
    expect(prompt).toContain("## Assembly Ownership")
    expect(prompt).toContain("surface=final-deliverable owner=gol_visual")
  })

  test("goal-path build receives the Architect Contract Graph, including sibling contracts", () => {
    const prompt = buildUserPrompt(
      {
        kind: "goal",
        id: "gol_feature",
        title: "Feature surface",
        objective: "Implement the feature and integrate it with the shared shell.",
        requirement_ids: [],
        acceptance_specs: ["feature works in shell"],
        owned_paths: ["src/feature.ts"],
        depends_on: ["gol_shell"],
      },
      {
        contractGraph: {
          version: 1,
          contracts: [
            {
              id: "contract_shell",
              kind: "component",
              name: "AppShell",
              producer_goal_id: "gol_shell",
              consumer_goal_ids: ["gol_feature"],
              summary: "Shared shell component consumed by the feature surface.",
              artifact_paths: ["src/App.tsx"],
            },
          ],
          dependency_contracts: [
            {
              from_goal_id: "gol_shell",
              to_goal_id: "gol_feature",
              reason: "contract",
              contract_ids: ["contract_shell"],
            },
          ],
        },
      },
    )

    expect(prompt).toContain("## Contract Graph")
    expect(prompt).toContain("contract_shell [component] AppShell")
    expect(prompt).toContain("producer=gol_shell; consumers=gol_feature")
    expect(prompt).toContain("## Dependency Reasons")
    expect(prompt).toContain("gol_shell -> gol_feature: reason=contract; contracts=contract_shell")
    expect(prompt).not.toContain("Imports:")
    expect(prompt).not.toContain("Exports:")
  })

  test("goal-path build receives sibling collaboration state without file sandbox framing", () => {
    const prompt = buildUserPrompt(
      {
        kind: "goal",
        id: "gol_feature",
        title: "Feature surface",
        objective: "Implement the feature and integrate it with the shared shell.",
        requirement_ids: [],
        acceptance_specs: ["feature works in shell"],
        owned_paths: ["src/feature.ts", "src/App.tsx"],
        depends_on: ["gol_shell"],
      },
      {
        collaborationGoals: [
          {
            id: "gol_shell",
            title: "Application shell",
            objective: "Provide the reusable application shell.",
            kind: "bootstrap",
            status: "passed",
            acceptance_specs: ["shell renders"],
            owned_paths: ["src/App.tsx", "src/main.tsx"],
            depends_on: [],
          },
          {
            id: "gol_feature",
            title: "Feature surface",
            objective: "Implement the feature and integrate it with the shared shell.",
            kind: "feature",
            status: "pending",
            acceptance_specs: ["feature works in shell"],
            owned_paths: ["src/feature.ts", "src/App.tsx"],
            depends_on: ["gol_shell"],
          },
        ],
      },
    )

    expect(prompt).toContain("## Collaboration State")
    expect(prompt).toContain("gol_shell")
    expect(prompt).toContain("status=passed")
    expect(prompt).toContain("Full sibling objectives and acceptance specs are intentionally not inlined here")
    expect(prompt).not.toContain("objective: Provide the reusable application shell.")
    expect(prompt).not.toContain("shell renders")
    expect(prompt).not.toContain("acceptance_specs_summary")
    expect(prompt).toContain("responsibility_paths: src/App.tsx, src/main.tsx")
    expect(prompt).toContain("owned_paths` are responsibility paths, not a file sandbox")
    expect(prompt).toContain("explained in `files_changed[]`")
    expect(prompt).toContain("**Responsibility Paths** (review focus, not a file sandbox)")
  })

  test("request-path build warns that visual references are authoritative", () => {
    const prompt = buildUserPrompt(
      {
        kind: "request",
        text: "Clone the attached webpage reference.",
      },
      {
        contextPackets: packets({
          frontendDesignBody:
            "# Frontend Design Public Report\n\n" +
            "- key=visual_consistency_contract value=The supplied reference is authoritative.",
        }),
      },
    )

    expect(prompt).toContain("## Visual Reference Overlay")
    expect(prompt).toContain("Referenced images, captures, and visual specs are binding source material")
  })

  test("request-path build triggers visual and clone overlays from schema-bearing non-frontend source", () => {
    const prompt = buildUserPrompt(
      {
        kind: "request",
        text: "Clone the AMD page.",
      },
      {
        contextPackets: [
          packet(
            "third_party_design",
            "Third Party Design Handoff",
            "# Public Design Report\n\nUse web-clone-source/reference.png and frontend-design-skeleton/src/App.tsx.",
            { visualReference: true, webCloneSource: true },
          ),
        ],
      },
      "tsk_third_party_visual_handoff",
    )

    expect(prompt).toContain("Rendered overlays: agent-context-packets, webpage-clone-source-baseline, visual-reference")
    expect(prompt).toContain("# Third Party Design Handoff")
    expect(prompt).toContain("source: third_party_design")
    expect(prompt).toContain("structured_ref: schema=opencorvus.context.visual_handoff.v1")
    expect(prompt).toContain("## Webpage Clone Source-Baseline Overlay")
    expect(prompt).toContain("## Visual Reference Overlay")
  })

  test("request-path build does not trigger visual overlays from frontend_design source without handoff schema", () => {
    const legacy = textContextPacket({
      id: "legacy-frontend-design",
      title: "Legacy Frontend Design Handoff",
      source: "frontend_design",
      scope: "task",
      body: "# Frontend Design Public Report\n\nVisual contract text without the build visual handoff schema.",
    })!
    const prompt = buildUserPrompt(
      {
        kind: "request",
        text: "Clone the reference.",
      },
      {
        contextPackets: [legacy],
      },
    )

    expect(prompt).toContain("# Legacy Frontend Design Handoff")
    expect(prompt).toContain("source: frontend_design")
    expect(prompt).not.toContain("## Visual Reference Overlay")
    expect(prompt).not.toContain("## Webpage Clone Source-Baseline Overlay")
  })

  test("build repair contract fingerprints come from schema-bearing packets instead of integrity source text", () => {
    const sourceOnly = packet(
      "integrity",
      "Legacy Integrity Feedback",
      "Blocking fingerprints:\n- if_1111111111111111: source-only marker must not activate host contract.",
    )
    const thirdParty = packet(
      "review_partner",
      "Third Party Repair Contract",
      "Repair every structured fingerprint before reporting passed.",
    )
    const repairPart = buildRepairContractStructuredPart({
      integrityBlockingFingerprints: ["if_2222222222222222", "if_2222222222222222"],
    })!
    const taggedThirdParty = { ...thirdParty, parts: [...thirdParty.parts, repairPart] }

    expect(buildIntegrityBlockingFingerprintsFromContextPackets([sourceOnly])).toEqual([])
    expect(buildIntegrityBlockingFingerprintsFromContextPackets([sourceOnly, taggedThirdParty])).toEqual([
      "if_2222222222222222",
    ])
  })

  test("build repair contract producer rejects invalid integrity fingerprints", () => {
    expect(() =>
      buildRepairContractStructuredPart({
        integrityBlockingFingerprints: ["if_not_valid"],
      }),
    ).toThrow("must match if_[a-f0-9]{16}")
  })

  test("build repair contract parser rejects malformed schema packets", () => {
    const malformed = {
      id: "malformed-build-repair-contract",
      title: "Malformed Build Repair Contract",
      scope: "task",
      parts: [
        {
          type: "structured",
          schema: "opencorvus.build.repair_contract.v1",
          data: { integrityBlockingFingerprints: ["if_2222222222222222", "if_not_valid"] },
        },
      ],
    } as AgentContextPacket
    const emptyContract = {
      ...malformed,
      id: "empty-build-repair-contract",
      parts: [
        {
          type: "structured",
          schema: "opencorvus.build.repair_contract.v1",
          data: {},
        },
      ],
    } as AgentContextPacket

    expect(() => buildIntegrityBlockingFingerprintsFromContextPackets([malformed])).toThrow(
      "integrityBlockingFingerprints[1] must match if_[a-f0-9]{16}",
    )
    expect(() => buildIntegrityBlockingFingerprintsFromContextPackets([emptyContract])).toThrow(
      "integrityBlockingFingerprints is required",
    )
  })

  test("request-path build receives frontend-research build pointer overlay", () => {
    const prompt = buildUserPrompt(
      {
        kind: "request",
        text: "Implement the researched webpage replica.",
      },
      {
        contextPackets: packets({
          frontendResearch:
            "Compact advisory coverage index from frontend_research.\n\n" +
            "Functional surfaces:\n- surface_tabs: floating tab bar appears after scroll and switches economic indicators.",
          frontendDesignBody:
            "# Frontend Design Public Report\n\n" + "- key=visual_consistency_contract value=Match the researched page.",
        }),
      },
    )

    expect(prompt).toContain("Rendered overlays: agent-context-packets, visual-reference")
    expect(prompt).toContain("# Frontend Research Build Pointers")
    expect(prompt).toContain("source: frontend_research")
    expect(prompt).toContain("# Frontend Design Handoff")
    expect(prompt).toContain("source: frontend_design")
    expect(prompt).not.toContain("webpage_contract")
    expect(prompt).not.toContain("```json")
    expect(prompt).toContain("floating tab bar appears after scroll")
    expect(prompt.indexOf("# Frontend Research Build Pointers")).toBeLessThan(
      prompt.indexOf("# Frontend Design Handoff"),
    )
  })

  test("plain document deliverable prompt does not inherit webpage clone policy", () => {
    const prompt = buildUserPrompt({
      kind: "request",
      text: "Write a Product Requirements Document for the account settings project.",
    })

    expect(prompt).toContain("Product Requirements Document")
    expect(prompt).not.toContain("web-clone-source")
    expect(prompt).not.toContain("webpage references")
    expect(prompt).not.toContain("frontend-design")
    expect(prompt).not.toContain("Visual Reference Overlay")
  })

  test("request-path build requires source/target investigation for rewrite work", () => {
    const prompt = buildUserPrompt({
      kind: "request",
      text: "Rewrite the C# KeyStatistics component as a TS/React component.",
    })

    expect(prompt).toContain("If the request is a port, migration, rewrite, clone, parity restoration")
    expect(prompt).toContain("complete investigation of the named source surface")
    expect(prompt).toContain("existing target conventions")
    expect(prompt).toContain("ad-hoc exploration")
  })

  test("request-path build receives frontend-design template source manifest", () => {
    const prompt = buildUserPrompt(
      {
        kind: "request",
        text: "Clone the AMD page.",
      },
      {
        contextPackets: packets({
          frontendDesignBody:
            "# Frontend Design Public Report\n\n" +
            "- key=frontend_template value=AMD dashboard\n" +
            "- key=quality_project_contract value=Build readable React source from the source skeleton, semantic components/data/style modules, and preserved CSS sidecars\n" +
            '- key=frontend_project value={\n  "status": "created",\n  "role": "source_baseline_input",\n  "project_root": "frontend-design-skeleton",\n  "source_package": "web-clone-source",\n  "entrypoints": ["frontend-design-skeleton/index.html"],\n  "generation_tool": "source-skeleton",\n  "notes": ["adoption_rule: copy/adapt into root app before build pass"]\n}\n' +
            "- key=visual_consistency_contract value=Match AMD page geometry and chart/table styling\n" +
            "- key=evidence_source_manifest value=references/url-amd.png\n" +
            "- key=fillable_modules value=Use web-clone-source/README.md, web-clone-source/implementation-blueprint.md, web-clone-source/source-ir/component-tree.json, web-clone-source/source-ir/content-model.json, web-clone-source/source-skeleton/critical.css, and source-skeleton evidence only for targeted gaps; source-evidence findings recorded",
          frontendDesignVisualHandoff: {
            visualReference: true,
            webCloneSource: true,
            projectMode: "source_baseline",
          },
        }),
      },
    )

    expect(prompt).toContain("Frontend Design Public Report")
    expect(prompt).toContain("quality_project_contract")
    expect(prompt).toContain("structured_ref: schema=opencorvus.context.visual_handoff.v1")
    expect(prompt).toContain("project_mode=source_baseline")
    expect(prompt).toContain("project modes for this attempt are: `source_baseline`")
    expect(prompt).toContain("If `project_mode=source_baseline`")
    expect(prompt).not.toContain("If `role=source_baseline_input`")
    expect(prompt).not.toContain("If `role=visual_baseline_input`")
    expect(prompt).not.toContain("If `role=implementation_target`")
    expect(prompt).toContain("adoption_rule")
    expect(prompt).toContain("source skeleton")
    expect(prompt).toContain("visual_consistency_contract")
    expect(prompt).toContain("evidence_source_manifest")
    expect(prompt).toContain("references/url-amd.png")
    expect(prompt).toContain("web-clone-source/implementation-blueprint.md")
    expect(prompt).toContain("web-clone-source/source-ir/component-tree.json")
    expect(prompt).toContain("web-clone-source/source-skeleton/critical.css")
    expect(prompt).toContain("source-evidence findings recorded")
    expect(prompt).not.toContain("web-clone-source-skeleton-consumption-audit.json")
    expect(prompt).toContain("Treat `.opencorvus/r/t/<task-key>/fd/` as read-only input")
    expect(prompt).toContain(
      "Do not copy `web-clone-source/`, `frontend-design-skeleton/`, `webpage-evidence/`, `references/`, or top-level `reference.png`",
    )
    expect(prompt).toContain("work from the frontend_design refined source first")
    expect(prompt).toContain("use the mismatch report for source-backed precision repair")
    expect(prompt).toContain("CSS repair must be source-backed")
    expect(prompt).toContain("Maintainable replacement should already be completed by frontend_design")
  })

  test("request-path build resolves web-clone source references through task runtime root", () => {
    const prompt = buildUserPrompt(
      {
        kind: "request",
        text: "Clone the AMD page.",
      },
      {
        contextPackets: packets({
          frontendDesignBody:
            "# Frontend Design Public Report\n\n" +
            '- key=frontend_project value={\n  "status": "created",\n  "role": "source_baseline_input",\n  "project_root": "frontend-design-skeleton",\n  "source_package": "web-clone-source",\n  "entrypoints": ["frontend-design-skeleton/index.html"],\n  "generation_tool": "source-skeleton",\n  "notes": []\n}\n' +
            "- key=fillable_modules value=Use web-clone-source/reference.png and frontend-design-skeleton/src/App.tsx.",
          frontendDesignVisualHandoff: {
            visualReference: true,
            webCloneSource: true,
            projectMode: "source_baseline",
          },
        }),
      },
      "tsk_reference_path_contract",
    )

    const paths = ProjectRuntimePaths.frontendDesignPaths("", "tsk_reference_path_contract")
    expect(prompt).toContain(`web-clone-source/reference.png\` means \`${paths.sourcePackageRelative}/reference.png\``)
    expect(prompt).toContain(`Resolve \`web-clone-source/...\` refs under \`${paths.sourcePackageRelative}/...\``)
    expect(prompt).toContain(`\`frontend-design-skeleton/...\` refs under \`${paths.skeletonProjectRelative}/...\``)
    expect(prompt).toContain("not `./web-clone-source/reference.png` in the acceptance root")
    expect(prompt).toContain("### Required Reference Image")
    expect(prompt).toContain(`Open and inspect \`${paths.sourcePackageRelative}/reference.png\``)
    expect(prompt).toContain("concrete source reference screenshot for this webpage clone handoff")
  })

  test("goal-path build resolves web-clone source references through the primary project runtime root", () => {
    const taskID = "tsk_goal_reference_path_contract"
    const projectDir = "C:\\primary\\runtime-project"
    const prompt = buildUserPrompt(
      {
        kind: "goal",
        id: "gol_clone_surface",
        title: "Clone reference surface",
        objective: "Implement the reference surface from frontend-design evidence.",
        requirement_ids: [],
        acceptance_specs: ["reference surface matches the frontend-design handoff"],
        owned_paths: ["src/App.tsx"],
        depends_on: [],
      },
      {
        projectDir,
        contextPackets: packets({
          frontendDesignBody:
            "# Frontend Design Public Report\n\n" +
            '- key=frontend_project value={\n  "status": "created",\n  "role": "source_baseline_input",\n  "project_root": "frontend-design-skeleton",\n  "source_package": "web-clone-source",\n  "entrypoints": ["frontend-design-skeleton/index.html"],\n  "generation_tool": "source-skeleton",\n  "notes": []\n}\n' +
            "- key=fillable_modules value=Use frontend-design-skeleton/src/App.tsx and source-ir/style-profile.json.",
          frontendDesignVisualHandoff: {
            visualReference: true,
            webCloneSource: true,
            projectMode: "source_baseline",
          },
        }),
      },
      taskID,
    )

    const paths = ProjectRuntimePaths.frontendDesignPaths(projectDir, taskID)
    expect(prompt).not.toContain(`web-clone-source/reference.png\` means`)
    expect(prompt).toContain(
      `Resolve \`web-clone-source/...\` refs under \`${paths.absoluteDir}/web-clone-source/...\``,
    )
    expect(prompt).toContain(
      `\`frontend-design-skeleton/...\` refs under \`${paths.absoluteDir}/frontend-design-skeleton/...\``,
    )
    expect(prompt).toContain(`Treat \`${paths.absoluteDir}/\` as read-only input`)
    expect(prompt).toContain(
      "This goal's visual target is the bound crop evidence named by the Reference Coverage Contract",
    )
    expect(prompt).not.toContain("not `./web-clone-source/reference.png` in the acceptance root")
    expect(prompt).not.toContain("top-level `reference.png`")
    expect(prompt).not.toContain("### Required Reference Image")
    expect(prompt).not.toContain(`Open and inspect \`${paths.absoluteDir}/web-clone-source/reference.png\``)
  })
})
