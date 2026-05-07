import { describe, expect, test } from "bun:test"
import { validatePersistedArchitectFidelity } from "../../src/orchestrator/tools"

describe("orchestrator architect fidelity gate", () => {
  test("rejects build dispatch when persisted fidelity coverage is incomplete", () => {
    const workDir = process.cwd()
    const issues = validatePersistedArchitectFidelity({
      task: {
        metadata: {
          architect_fidelity: {
            sourceCoverage: [],
            referenceCoverage: [],
            assemblyOwners: [],
          },
        },
        design_specs: [{
          id: "vis-hero",
          category: "layout",
          title: "Hero layout",
          requirement: "Restore the hero layout exactly.",
          applies_to: "hero",
          severity: "must",
        }],
      } as any,
      goals: [
        { id: "goal_feature", owned_paths: ["packages/opencorvus/src/orchestrator/tools.ts"] },
        { id: "goal_verify", owned_paths: ["packages/opencorvus/test/orchestrator/architect-fidelity-gate.test.ts"] },
      ],
      workDir,
    })

    expect(issues).toContain("Missing source coverage for existing owned paths: packages/opencorvus/src/orchestrator/tools.ts, packages/opencorvus/test/orchestrator/architect-fidelity-gate.test.ts")
    expect(issues).toContain("Missing reference coverage for visual specs: vis-hero")
    expect(issues).toContain("Missing assembly ownership: multi-goal tasks must register at least one assembly owner")
  })

  test("allows build dispatch when persisted fidelity coverage is complete", () => {
    const workDir = process.cwd()
    const issues = validatePersistedArchitectFidelity({
      task: {
        metadata: {
          architect_fidelity: {
            sourceCoverage: [{
              id: "src-orchestrator-tools",
              paths: ["packages/opencorvus/src/orchestrator/tools.ts"],
              goal_ids: ["goal_feature"],
              action: "modify",
              rationale: "Feature goal owns the existing orchestrator dispatch behavior.",
            }],
            referenceCoverage: [{
              id: "ref-hero",
              surface: "hero",
              goal_ids: ["goal_feature"],
              visual_spec_ids: ["vis-hero"],
              expectation: "Feature goal must restore the hero 1:1 from the authoritative reference.",
            }],
            assemblyOwners: [{
              surface: "final-deliverable",
              goal_id: "goal_feature",
              rationale: "Feature goal owns the shared stitched deliverable.",
            }],
          },
        },
        design_specs: [{
          id: "vis-hero",
          category: "layout",
          title: "Hero layout",
          requirement: "Restore the hero layout exactly.",
          applies_to: "hero",
          severity: "must",
        }],
      } as any,
      goals: [
        { id: "goal_feature", owned_paths: ["packages/opencorvus/src/orchestrator/tools.ts"] },
        { id: "goal_verify", owned_paths: ["tests/integration/fidelity-gate.test.ts"] },
      ],
      workDir,
    })

    expect(issues).toEqual([])
  })

  test("does not block execution-stage build on source coverage for files created by earlier goals", () => {
    const workDir = process.cwd()
    const issues = validatePersistedArchitectFidelity({
      task: {
        metadata: {
          architect_fidelity: {
            sourceCoverage: [],
            referenceCoverage: [],
            assemblyOwners: [],
          },
        },
        design_specs: [],
      } as any,
      goals: [
        { id: "goal_feature", owned_paths: ["packages/opencorvus/src/orchestrator/tools.ts"] },
      ],
      workDir,
      executionStarted: true,
    })

    expect(issues).toEqual([])
  })

  test("still blocks execution-stage build when reference coverage is missing", () => {
    const workDir = process.cwd()
    const issues = validatePersistedArchitectFidelity({
      task: {
        metadata: {
          architect_fidelity: {
            sourceCoverage: [],
            referenceCoverage: [],
            assemblyOwners: [],
          },
        },
        design_specs: [{
          id: "vis-hero",
          category: "layout",
          title: "Hero layout",
          requirement: "Restore the hero layout exactly.",
          applies_to: "hero",
          severity: "must",
        }],
      } as any,
      goals: [
        { id: "goal_feature", owned_paths: ["packages/opencorvus/src/orchestrator/tools.ts"] },
      ],
      workDir,
      executionStarted: true,
    })

    expect(issues).not.toContain("Missing source coverage for existing owned paths: packages/opencorvus/src/orchestrator/tools.ts")
    expect(issues).toContain("Missing reference coverage for visual specs: vis-hero")
  })
})
