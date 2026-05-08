import { describe, expect, test } from "bun:test"
import { buildUserPrompt } from "../../src/build/agent"

describe("build agent prompt context", () => {
  test("request-path build receives canonical delivery feedback", () => {
    const prompt = buildUserPrompt(
      {
        kind: "request",
        text: "Fix the integrated calculator deliverable.",
      },
      {
        deliveryFeedback:
          "Delivery agent rejected the integrated deliverable.\n" +
          "Canonical delivery feedback packet (JSON, copied from persisted artifacts):\n" +
          "```json\n{\"manifest\":{\"finalGate\":{\"failedRuntimeFlowIds\":[\"runtime:web:.\"]}}}\n```",
      },
    )

    expect(prompt).toContain("## Canonical Delivery Rejection Feedback")
    expect(prompt).toContain("runtime:web:.")
    expect(prompt.indexOf("## Canonical Delivery Rejection Feedback")).toBeLessThan(prompt.indexOf("# Request"))
  })

  test("goal-path build receives canonical delivery feedback separately from retry summary", () => {
    const prompt = buildUserPrompt(
      {
        kind: "goal",
        id: "gol_calc",
        title: "Calculator UI",
        objective: "Build a scientific calculator UI.",
        acceptance_specs: ["calculator renders"],
        owned_paths: ["src/App.tsx"],
        exports: [],
        imports: [],
        depends_on: [],
      },
      {
        retryFeedback: "Old coordinator summary.",
        deliveryFeedback: "Raw verdict artifact JSON with dom_too_thin.",
      },
    )

    expect(prompt).toContain("Old coordinator summary.")
    expect(prompt).toContain("## Canonical Delivery Rejection Feedback")
    expect(prompt).toContain("dom_too_thin")
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
        exports: [],
        imports: [],
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

  test("request-path renders retryGuidance under its own heading", () => {
    const prompt = buildUserPrompt(
      {
        kind: "request",
        text: "Implement the calculator.",
      },
      {
        retryGuidance: "Re-run after fixing the missing terminal tool call.",
        deliveryFeedback: "Raw verdict JSON.",
      },
    )

    expect(prompt).toContain("## Retry Guidance From Orchestrator")
    expect(prompt).toContain("Re-run after fixing the missing terminal tool call.")
    expect(prompt.indexOf("## Retry Guidance From Orchestrator")).toBeLessThan(
      prompt.indexOf("## Canonical Delivery Rejection Feedback"),
    )
    expect(prompt.indexOf("## Canonical Delivery Rejection Feedback")).toBeLessThan(prompt.indexOf("# Request"))
  })

  test("retryGuidance section is dropped when undefined / empty / whitespace-only", () => {
    const baseTarget = {
      kind: "goal" as const,
      id: "gol_x",
      title: "X",
      objective: "Build X.",
      acceptance_specs: [],
      owned_paths: [],
      exports: [],
      imports: [],
      depends_on: [],
    }
    expect(buildUserPrompt(baseTarget, {})).not.toContain("## Retry Guidance From Orchestrator")
    expect(buildUserPrompt(baseTarget, { retryGuidance: "" })).not.toContain("## Retry Guidance From Orchestrator")
    expect(buildUserPrompt(baseTarget, { retryGuidance: "   \n\n\t  " })).not.toContain(
      "## Retry Guidance From Orchestrator",
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
        exports: [],
        imports: [],
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
    expect(prompt).toContain("Do not approximate or redesign")
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
        exports: [],
        imports: [],
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

  test("goal-path build receives the complete architect consensus, including sibling contracts", () => {
    const prompt = buildUserPrompt(
      {
        kind: "goal",
        id: "gol_feature",
        title: "Feature surface",
        objective: "Implement the feature and integrate it with the shared shell.",
        acceptance_specs: ["feature works in shell"],
        owned_paths: ["src/feature.ts"],
        exports: ["renderFeature(): JSX.Element"],
        imports: ["AppShell from gol_shell"],
        depends_on: ["gol_shell"],
      },
      {
        architectContracts: [
          {
            category: "shell_contract",
            title: "Shell exports",
            spec: "gol_shell owns AppShell and exports it for feature goals.",
            goalIDs: ["gol_shell"],
          },
          {
            category: "feature_contract",
            title: "Feature mount",
            spec: "gol_feature mounts inside AppShell without replacing the shell.",
            goalIDs: ["gol_feature"],
          },
        ],
      },
    )

    expect(prompt).toContain("complete architecture consensus")
    expect(prompt).toContain("Shell exports")
    expect(prompt).toContain("(dependency contract: gol_shell)")
    expect(prompt).toContain("Feature mount")
    expect(prompt).toContain("(this goal)")
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
        exports: ["renderFeature(): JSX.Element"],
        imports: ["AppShell from gol_shell"],
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
            exports: ["AppShell"],
            imports: [],
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
            exports: ["renderFeature(): JSX.Element"],
            imports: ["AppShell from gol_shell"],
          },
        ],
      },
    )

    expect(prompt).toContain("## Collaboration State")
    expect(prompt).toContain("gol_shell")
    expect(prompt).toContain("status=passed")
    expect(prompt).toContain("objective: Provide the reusable application shell.")
    expect(prompt).toContain("shell renders")
    expect(prompt).toContain("responsibility_paths: src/App.tsx, src/main.tsx")
    expect(prompt).toContain("owned_paths` are responsibility paths, not a file sandbox")
    expect(prompt).toContain("explained in `files_changed[]`")
    expect(prompt).toContain("**Responsibility Paths** (review focus, not a file sandbox)")
  })

  test("request-path build warns that visual references are authoritative", () => {
    const prompt = buildUserPrompt({
      kind: "request",
      text: "Clone the attached webpage reference.",
    })

    expect(prompt).toContain("those references are authoritative")
    expect(prompt).toContain("must restore them 1:1")
  })

  test("request-path build receives design-analysis PRD/SPEC source manifest", () => {
    const prompt = buildUserPrompt(
      {
        kind: "request",
        text: "Clone the AMD page.",
      },
      {
        designAnalysis:
          "# Design Analysis PRD/SPEC Source\n\n" +
          "- key=product_spec value=AMD dashboard\n" +
          "- key=visual_consistency_spec value=Match AMD page geometry and chart/table styling\n" +
          "- key=evidence_source_manifest value=references/url-amd.png",
      },
    )

    expect(prompt).toContain("## Design Analysis PRD/SPEC Source")
    expect(prompt).toContain("visual_consistency_spec")
    expect(prompt).toContain("evidence_source_manifest")
    expect(prompt).toContain("references/url-amd.png")
  })
})
