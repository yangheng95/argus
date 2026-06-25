import { describe, expect, test } from "bun:test"
import {
  architectValidationFindings,
  architectValidationIssues,
  type ArchitectCollector,
} from "../../src/architect/output-tools"
import { validatePersistedArchitectFidelity } from "../../src/orchestrator/tools"
import type { AcceptanceSpec } from "../../src/acceptance/types"

const essentialAcceptanceVisualSpec: AcceptanceSpec = {
  id: "acc-final-visual-fidelity",
  source_requirement_id: "REQ-visual",
  goal_id: "goal_verify",
  title: "Final rendered page matches the authoritative visual references for final-page",
  severity: "essential",
  trigger: "on_integrity",
  scorers: [
    {
      type: "llm_judge",
      name: "rendered-reference-fidelity",
      criteria:
        "Compare final rendered_output against the authoritative references and frontend template visual_consistency_contract.",
      inputs: ["visual_evidence"],
    },
  ],
}

const textOnlyAcceptanceVisualSpec: AcceptanceSpec = {
  ...essentialAcceptanceVisualSpec,
  scorers: [
    {
      type: "llm_judge",
      name: "rendered-reference-fidelity",
      criteria:
        "Compare final rendered_output against the authoritative references and frontend template visual_consistency_contract.",
    },
  ],
}

const prebuiltVisualEvidenceSpec: AcceptanceSpec = {
  ...essentialAcceptanceVisualSpec,
  scorers: [
    {
      type: "prebuilt",
      name: "visual-evidence-bundle",
      config: {},
      spec: { kind: "visual_evidence_bundle", viewport: "desktop-primary" },
      expect: { status: "passed" },
    },
  ],
}

function collectorForReferenceTask(specs: AcceptanceSpec[]): ArchitectCollector {
  return {
    goals: [
      {
        id: "goal_feature",
        title: "Feature implementation",
        objective: "Implement the reference-driven page surface that the verification goal evaluates.",
        acceptance_specs: [],
        owned_paths: ["src/page.tsx"],
        depends_on: [],
        priority: "blocking",
        kind: "feature",
        requirement_ids: [],
      },
      {
        id: "goal_verify",
        title: "Verification",
        objective: "Verify the final reference-driven page against the frontend template and rendered browser output.",
        acceptance_specs: specs,
        owned_paths: ["tests/e2e/visual.test.ts"],
        depends_on: [],
        priority: "blocking",
        kind: "verification",
        requirement_ids: ["REQ-visual"],
      },
    ],
    traceability: [{ requirementID: "REQ-visual", goalIDs: ["goal_verify"] }],
    source_coverage: [],
    reference_coverage: [
      {
        id: "ref-page",
        surface: "final-page",
        goal_ids: ["goal_verify"],
        visual_spec_ids: [],
        expectation: "Restore the authoritative reference page 1:1.",
      },
    ],
    assembly_owners: [],
    contract_graph: { version: 1, contracts: [], dependency_contracts: [] },
    validation_findings: [],
    removed_goal_ids: [],
    summary: "",
    finalized: false,
  }
}

describe("orchestrator architect fidelity diagnostics", () => {
  test("reports persisted fidelity coverage gaps without making them dispatch blockers", () => {
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
        design_specs: [
          {
            id: "vis-hero",
            category: "layout",
            title: "Hero layout",
            requirement: "Restore the hero layout exactly.",
            applies_to: "hero",
            severity: "must",
          },
        ],
      } as any,
      goals: [
        { id: "goal_feature", owned_paths: ["packages/opencorvus/src/orchestrator/tools.ts"] },
        { id: "goal_verify", owned_paths: ["packages/opencorvus/test/orchestrator/architect-fidelity-gate.test.ts"] },
      ],
      workDir,
    })

    expect(issues).toContain(
      "Missing source coverage for existing owned paths: packages/opencorvus/src/orchestrator/tools.ts, packages/opencorvus/test/orchestrator/architect-fidelity-gate.test.ts",
    )
    expect(issues).toContain("Missing reference coverage for visual specs: vis-hero")
    expect(issues).toContain("Missing assembly ownership: multi-goal tasks must register at least one assembly owner")
  })

  test("reports no persisted fidelity diagnostics when coverage is complete", () => {
    const workDir = process.cwd()
    const issues = validatePersistedArchitectFidelity({
      task: {
        metadata: {
          architect_fidelity: {
            sourceCoverage: [
              {
                id: "src-orchestrator-tools",
                paths: ["packages/opencorvus/src/orchestrator/tools.ts"],
                goal_ids: ["goal_feature"],
                action: "modify",
                rationale: "Feature goal owns the existing orchestrator dispatch behavior.",
              },
            ],
            referenceCoverage: [
              {
                id: "ref-hero",
                surface: "hero",
                goal_ids: ["goal_feature"],
                visual_spec_ids: ["vis-hero"],
                expectation: "Feature goal must restore the hero 1:1 from the authoritative reference.",
              },
            ],
            assemblyOwners: [
              {
                surface: "final-deliverable",
                goal_id: "goal_feature",
                rationale: "Feature goal owns the shared stitched deliverable.",
              },
            ],
          },
        },
        design_specs: [
          {
            id: "vis-hero",
            category: "layout",
            title: "Hero layout",
            requirement: "Restore the hero layout exactly.",
            applies_to: "hero",
            severity: "must",
          },
        ],
      } as any,
      goals: [
        { id: "goal_feature", owned_paths: ["packages/opencorvus/src/orchestrator/tools.ts"] },
        { id: "goal_verify", owned_paths: ["tests/integration/fidelity-gate.test.ts"] },
      ],
      workDir,
    })

    expect(issues).toEqual([])
  })

  test("does not report execution-stage source coverage for files created by earlier goals", () => {
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
      goals: [{ id: "goal_feature", owned_paths: ["packages/opencorvus/src/orchestrator/tools.ts"] }],
      workDir,
      executionStarted: true,
    })

    expect(issues).toEqual([])
  })

  test("still reports execution-stage reference coverage when it is missing", () => {
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
        design_specs: [
          {
            id: "vis-hero",
            category: "layout",
            title: "Hero layout",
            requirement: "Restore the hero layout exactly.",
            applies_to: "hero",
            severity: "must",
          },
        ],
      } as any,
      goals: [{ id: "goal_feature", owned_paths: ["packages/opencorvus/src/orchestrator/tools.ts"] }],
      workDir,
      executionStarted: true,
    })

    expect(issues).not.toContain(
      "Missing source coverage for existing owned paths: packages/opencorvus/src/orchestrator/tools.ts",
    )
    expect(issues).toContain("Missing reference coverage for visual specs: vis-hero")
  })

  test("reports reference-driven architecture without visual evidence acceptance as a concern", () => {
    const weakVisualSpec: AcceptanceSpec = {
      ...essentialAcceptanceVisualSpec,
      severity: "important",
    }
    const findings = architectValidationFindings(collectorForReferenceTask([weakVisualSpec]), {
      requireReferenceCoverage: true,
    })

    expect(
      findings.some(
        (finding) =>
          finding.severity === "blocker" &&
          finding.message.includes(
            "Missing visual evidence acceptance advisory: reference-driven tasks should include a verification/integration goal",
          ),
      ),
    ).toBe(false)
    expect(
      findings.some(
        (finding) =>
          finding.severity === "concern" &&
          finding.message.includes(
            "Missing visual evidence acceptance advisory: reference-driven tasks should include a verification/integration goal",
          ),
      ),
    ).toBe(true)
    expect(architectValidationIssues(collectorForReferenceTask([weakVisualSpec]), { requireReferenceCoverage: true }))
      .toEqual([])
  })

  test("reports text-only visual judge as missing visual evidence acceptance", () => {
    const findings = architectValidationFindings(collectorForReferenceTask([textOnlyAcceptanceVisualSpec]), {
      requireReferenceCoverage: true,
    })

    expect(
      findings.some(
        (finding) => finding.code === "missing_final_visual_acceptance" && finding.severity === "concern",
      ),
    ).toBe(true)
  })

  test("reports final visual evidence spec that omits a registered reference region as a concern", () => {
    const spec: AcceptanceSpec = {
      ...prebuiltVisualEvidenceSpec,
      title: "Desktop visual evidence bundle passes",
    }
    const findings = architectValidationFindings(collectorForReferenceTask([spec]), {
      requireReferenceCoverage: true,
    })

    expect(
      findings.some(
        (finding) => finding.code === "missing_visual_region_acceptance_ownership" && finding.severity === "concern",
      ),
    ).toBe(true)
    expect(architectValidationIssues(collectorForReferenceTask([spec]), { requireReferenceCoverage: true })).toEqual([])
  })

  test("allows reference-driven architecture with visual_evidence judge input", () => {
    const issues = architectValidationIssues(collectorForReferenceTask([essentialAcceptanceVisualSpec]), {
      requireReferenceCoverage: true,
    })

    expect(issues).toEqual([])
  })

  test("allows reference-driven architecture with visual evidence bundle prebuilt scorer", () => {
    const issues = architectValidationIssues(collectorForReferenceTask([prebuiltVisualEvidenceSpec]), {
      requireReferenceCoverage: true,
    })

    expect(issues).toEqual([])
  })
})
