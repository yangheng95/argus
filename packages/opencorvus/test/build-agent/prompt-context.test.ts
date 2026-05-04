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

  test("request-path build warns that visual references are authoritative", () => {
    const prompt = buildUserPrompt({
      kind: "request",
      text: "Clone the attached webpage reference.",
    })

    expect(prompt).toContain("those references are authoritative")
    expect(prompt).toContain("must restore them 1:1")
  })
})
