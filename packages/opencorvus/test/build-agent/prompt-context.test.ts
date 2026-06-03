import { describe, expect, test } from "bun:test"
import { buildRetryFeedbackPrompt, buildUserPrompt } from "../../src/build/agent"

describe("build agent prompt context", () => {
  test("request-path build receives canonical acceptance feedback", () => {
    const prompt = buildUserPrompt(
      {
        kind: "request",
        text: "Fix the integrated calculator deliverable.",
      },
      {
        acceptanceFeedback:
          "Acceptance review rejected the integrated deliverable.\n" +
          "Canonical acceptance feedback packet (JSON, copied from persisted artifacts):\n" +
          "```json\n{\"manifest\":{\"finalGate\":{\"failedReviewIds\":[\"review:contract_audit\"]}}}\n```",
      },
    )

    expect(prompt).toContain("## Acceptance Repair Overlay")
    expect(prompt).toContain("review:contract_audit")
    expect(prompt.indexOf("## Acceptance Repair Overlay")).toBeLessThan(prompt.indexOf("# Request"))
  })

  test("goal-path build receives canonical acceptance feedback separately from retry summary", () => {
    const prompt = buildUserPrompt(
      {
        kind: "goal",
        id: "gol_calc",
        title: "Calculator UI",
        objective: "Build a scientific calculator UI.",
        acceptance_specs: ["calculator renders"],
        owned_paths: ["src/App.tsx"],
        depends_on: [],
      },
      {
        retryFeedback: "Old coordinator summary.",
        acceptanceFeedback: "Raw verdict artifact JSON with contract_audit_failure.",
      },
    )

    expect(prompt).toContain("Old coordinator summary.")
    expect(prompt).toContain("## Acceptance Repair Overlay")
    expect(prompt).toContain("contract_audit_failure")
    expect(prompt.indexOf("Raw verdict artifact JSON")).toBeLessThan(prompt.indexOf("# Goal: Calculator UI"))
  })

  /**
   * Spec build-missing-terminal-signal-restore-2026-05-07.md §5.2.
   * retryGuidance is the orchestrator LLM's first-class instruction for
   * THIS attempt — it must render before historical retryFeedback (the
   * orchestrator's just-now decision honours over historical context),
   * and never replace the goal's objective / acceptance_specs.
   */
  test("goal-path renders retryGuidance under its own heading and preserves the goal contract", () => {
    const prompt = buildUserPrompt(
      {
        kind: "goal",
        id: "gol_chat_ui",
        title: "聊天UI组件",
        objective: "Build the chat UI components per Gemini design.",
        acceptance_specs: ["MessageList renders streaming messages"],
        owned_paths: ["src/components"],
        depends_on: [],
      },
      {
        retryGuidance:
          "Previous attempt did not call report_build_result before turn ended. This attempt MUST call it exactly once after verification.",
        retryFeedback:
          "## Prior Attempt Failed — Read This Before Implementing\n- coordinator note: see retry context.",
      },
    )

    // retryGuidance heading present and content rendered
    expect(prompt).toContain("## Retry Guidance From Orchestrator")
    expect(prompt).toContain("Previous attempt did not call report_build_result")
    expect(prompt).toContain("MUST call it exactly once")

    // Order: retryGuidance before retryFeedback before the goal contract
    expect(prompt.indexOf("## Retry Guidance From Orchestrator")).toBeLessThan(
      prompt.indexOf("## Prior Attempt Failed"),
    )
    expect(prompt.indexOf("## Prior Attempt Failed")).toBeLessThan(prompt.indexOf("# Goal: 聊天UI组件"))

    // The architect-committed objective is preserved verbatim — retryGuidance
    // does NOT replace it (the bug spec §5.2 fixes).
    expect(prompt).toContain("**Objective**: Build the chat UI components per Gemini design.")
  })

  test("goal-path renders persistent integrity findings before retry guidance", () => {
    const prompt = buildUserPrompt(
      {
        kind: "goal",
        id: "gol_settings",
        title: "Settings repair",
        objective: "Repair settings validation.",
        acceptance_specs: ["settings are validated"],
        owned_paths: ["src/services/storage.ts"],
        depends_on: [],
      },
      {
        integrityFeedback:
          "## Persistent Integrity Findings (Treat Blocking Items As Must-Fix)\n\n" +
          "- **BF-settings**: getSettings does not validate persisted settings.",
        retryGuidance: "Focus on the storage service.",
      },
    )

    expect(prompt).toContain("## Persistent Integrity Findings")
    expect(prompt).toContain("BF-settings")
    expect(prompt.indexOf("## Persistent Integrity Findings")).toBeLessThan(
      prompt.indexOf("## Retry Guidance From Orchestrator"),
    )
    expect(prompt.indexOf("## Retry Guidance From Orchestrator")).toBeLessThan(
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
    expect(prompt).toContain("read the PRD/frontend_design material and any frontend_research investigation packets in page chunks")
    expect(prompt).toContain("identify the component kind for each chunk")
    expect(prompt).toContain("All visible content must be componentized and fed by props, data modules, fixtures, or API adapters")
    expect(prompt).toContain("instead of hardcoded directly into page wrappers, generated SVG, or one-off JSX literals")
    expect(prompt).toContain("Charts, maps, heatmaps, geographic visualizations")
    expect(prompt).toContain("Do not replace a chart/map/heatmap with a flat SVG/image/decorative vector")
    expect(prompt).toContain("Weight the sources accordingly")
    expect(prompt).toContain("drive roughly 70% of implementation decisions")
    expect(prompt).toContain("supplies roughly 30% style, geometry, CSS, assets, and pixel-consistency support")
    expect(prompt).toContain("Frontend_research packets are coverage and investigation prompts")
    expect(prompt).toContain("REQ-12")
    expect(prompt).toContain("fr-interaction-scroll-tabs")
    expect(prompt).toContain("## Terminal Report Contract")
    expect(prompt).toContain("contract_restatement")
    expect(prompt).toContain("followup_workload_guidance")
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
    expect(prompt.indexOf("## Requirements / PRD Coverage Contract")).toBeLessThan(prompt.indexOf("# Request"))
  })

  test("request-path renders retryGuidance under its own heading", () => {
    const prompt = buildUserPrompt(
      {
        kind: "request",
        text: "Implement the calculator.",
      },
      {
        retryGuidance: "Re-run after fixing the missing terminal tool call.",
        acceptanceFeedback: "Raw verdict JSON.",
      },
    )

    expect(prompt).toContain("## Retry Guidance From Orchestrator")
    expect(prompt).toContain("Re-run after fixing the missing terminal tool call.")
    expect(prompt.indexOf("## Retry Guidance From Orchestrator")).toBeLessThan(
      prompt.indexOf("## Acceptance Repair Overlay"),
    )
    expect(prompt.indexOf("## Acceptance Repair Overlay")).toBeLessThan(prompt.indexOf("# Request"))
  })

  test("request-path renders persistent integrity findings before request delegation", () => {
    const prompt = buildUserPrompt(
      {
        kind: "request",
        text: "Repair the direct build after integrity review.",
      },
      {
        integrityFeedback:
          "## Persistent Integrity Findings (Treat Blocking Items As Must-Fix)\n\n" +
          "- **BF-direct**: direct build missed required validation.",
        retryFeedback: "Previous build failed.",
      },
    )

    expect(prompt).toContain("## Persistent Integrity Findings")
    expect(prompt).toContain("BF-direct")
    expect(prompt.indexOf("## Persistent Integrity Findings")).toBeLessThan(
      prompt.indexOf("## Prior Attempt Failed"),
    )
    expect(prompt.indexOf("## Persistent Integrity Findings")).toBeLessThan(prompt.indexOf("# Request"))
  })

  test("same-session retry prompt renders persistent integrity findings before retry facts", () => {
    const prompt = buildRetryFeedbackPrompt(
      {
        kind: "request",
        text: "Repair the direct build after integrity review.",
      },
      {
        integrityFeedback:
          "## Persistent Integrity Findings (Treat Blocking Items As Must-Fix)\n\n" +
          "- **BF-retry**: retry still lacks storage validation.",
        retryFeedback: "Prior attempt failed.",
        acceptanceFeedback: "Acceptance rejected.",
      },
    )

    expect(prompt).toContain("## Persistent Integrity Findings")
    expect(prompt).toContain("BF-retry")
    expect(prompt.indexOf("## Persistent Integrity Findings")).toBeLessThan(
      prompt.indexOf("## Prior Attempt Failure Facts"),
    )
    expect(prompt.indexOf("## Prior Attempt Failure Facts")).toBeLessThan(
      prompt.indexOf("## Acceptance Repair Overlay"),
    )
    expect(prompt).toContain("Restate the detailed req/goal contract")
    expect(prompt).toContain("workload may still be underestimated")
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

  test("retryGuidance section is dropped when undefined / empty / whitespace-only", () => {
    const baseTarget = {
      kind: "goal" as const,
      id: "gol_x",
      title: "X",
      objective: "Build X.",
      acceptance_specs: [],
      owned_paths: [],
      depends_on: [],
    }
    expect(buildUserPrompt(baseTarget, {})).not.toContain("## Retry Guidance From Orchestrator")
    expect(buildUserPrompt(baseTarget, { retryGuidance: "" })).not.toContain("## Retry Guidance From Orchestrator")
    expect(buildUserPrompt(baseTarget, { retryGuidance: "   \n\n\t  " })).not.toContain(
      "## Retry Guidance From Orchestrator",
    )
    expect(buildUserPrompt(baseTarget, { integrityFeedback: "   \n\n\t  " })).not.toContain(
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
        acceptance_specs: ["hero matches reference"],
        owned_paths: ["src/App.tsx"],
        depends_on: [],
      },
      {
        designSpecs: [{
          severity: "high",
          category: "layout",
          title: "Hero layout",
          requirement: "Two-column hero with exact spacing.",
          applies_to: "hero",
        }],
      } as any,
    )

    expect(prompt).toContain("restore the relevant subset 1:1 as closely as the stack allows")
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
        acceptance_specs: ["hero matches reference"],
        owned_paths: ["src/App.tsx"],
        depends_on: [],
      },
      {
        fidelity: {
          sourceCoverage: [{
            id: "src-app-shell",
            paths: ["src/App.tsx"],
            goal_ids: ["gol_visual"],
            action: "modify",
            rationale: "This goal must adapt the existing app shell rather than bypass it.",
          }],
          referenceCoverage: [{
            id: "ref-hero",
            surface: "hero",
            goal_ids: ["gol_visual"],
            visual_spec_ids: ["vis-hero"],
            expectation: "Restore the hero 1:1 from the reference.",
          }],
          assemblyOwners: [{
            surface: "final-deliverable",
            goal_id: "gol_visual",
            rationale: "This goal owns final stitching for the deliverable shell.",
          }],
        },
      } as any,
    )

    expect(prompt).toContain("## Source Coverage Contract")
    expect(prompt).toContain("src/App.tsx")
    expect(prompt).toContain("## Reference Coverage Contract")
    expect(prompt).toContain("visual_specs=vis-hero")
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
        frontendDesign:
          "# Frontend Design Public Report\n\n" +
          "- key=visual_consistency_contract value=The supplied reference is authoritative.",
      },
    )

    expect(prompt).toContain("## Visual Reference Overlay")
    expect(prompt).toContain("Referenced images, captures, and visual specs are binding source material")
  })

  test("request-path build receives frontend-research investigation plan overlay", () => {
    const prompt = buildUserPrompt(
      {
        kind: "request",
        text: "Implement the researched webpage replica.",
      },
      {
        frontendResearch:
          "# Frontend Research Brief (webpage investigation division)\n\n" +
          "work_packet: verify whether the floating tab bar appears after scroll and switches economic indicators.",
        frontendDesign:
          "# Frontend Design Public Report\n\n" +
          "- key=visual_consistency_contract value=Match the researched page.",
      },
    )

    expect(prompt).toContain("Rendered overlays: frontend-research-investigation-plan, frontend-design-handoff")
    expect(prompt).toContain("## Frontend Research Investigation Plan")
    expect(prompt).toContain("Treat it as a coverage checklist and work-packet index")
    expect(prompt).toContain("do not treat it as completed PRD facts")
    expect(prompt).toContain("read the named work packets")
    expect(prompt).toContain("Preserve component-kind hypotheses unless deeper evidence disproves them")
    expect(prompt).toContain("do not flatten it into SVG/image markup")
    expect(prompt).toContain("Use requirements, architect contracts, and frontend_design as the binding implementation contract")
    expect(prompt).toContain("floating tab bar appears after scroll")
    expect(prompt.indexOf("## Frontend Research Investigation Plan")).toBeLessThan(
      prompt.indexOf("## Frontend Design Handoff"),
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
        frontendDesign:
          "# Frontend Design Public Report\n\n" +
          "- key=frontend_template value=AMD dashboard\n" +
          "- key=quality_project_contract value=Build readable React source from the source skeleton, semantic components/data/style modules, and preserved CSS sidecars\n" +
          "- key=frontend_project value=status: created\nrole: source_baseline_input\nproject_root: frontend-design-skeleton\nacceptance_root: .\nadoption_rule: copy/adapt into root app before build pass\n" +
          "- key=visual_consistency_contract value=Match AMD page geometry and chart/table styling\n" +
          "- key=evidence_source_manifest value=references/url-amd.png\n" +
          "- key=fillable_modules value=Use web-clone-source/README.md, web-clone-source/implementation-blueprint.md, web-clone-source/source-ir/component-tree.json, web-clone-source/source-ir/content-model.json, web-clone-source/source-skeleton/critical.css, and source-skeleton evidence only for targeted gaps; web-clone-source-skeleton-consumption-audit.json passed",
      },
    )

    expect(prompt).toContain("Frontend Design Public Report")
    expect(prompt).toContain("quality_project_contract")
    expect(prompt).toContain("role: source_baseline_input")
    expect(prompt).toContain("adoption_rule")
    expect(prompt).toContain("source skeleton")
    expect(prompt).toContain("visual_consistency_contract")
    expect(prompt).toContain("evidence_source_manifest")
    expect(prompt).toContain("references/url-amd.png")
    expect(prompt).toContain("web-clone-source/implementation-blueprint.md")
    expect(prompt).toContain("web-clone-source/source-ir/component-tree.json")
    expect(prompt).toContain("web-clone-source/source-skeleton/critical.css")
    expect(prompt).toContain("web-clone-source-skeleton-consumption-audit.json passed")
    expect(prompt).toContain("Treat `.opencorvus/runtime/tasks/<taskID>/frontend-design/` as read-only input")
    expect(prompt).toContain("Do not copy `web-clone-source/`, `frontend-design-skeleton/`, `webpage-evidence/`, `references/`, or top-level `reference.png`")
    expect(prompt).toContain("work from the frontend_design refined source first")
    expect(prompt).toContain("use the mismatch report for source-backed precision repair")
    expect(prompt).toContain("CSS repair must be source-backed")
    expect(prompt).toContain("Maintainable replacement should already be completed by frontend_design")
  })
})
