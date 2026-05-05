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
            kind: "bootstrap",
            status: "passed",
            owned_paths: ["src/App.tsx", "src/main.tsx"],
            depends_on: [],
            exports: ["AppShell"],
            imports: [],
          },
          {
            id: "gol_feature",
            title: "Feature surface",
            kind: "feature",
            status: "pending",
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
})
