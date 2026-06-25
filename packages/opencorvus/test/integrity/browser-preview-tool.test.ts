import { describe, expect, test } from "bun:test"
import { Agent } from "../../src/agent/agent"
import { AgentToolPool } from "../../src/agent/tool-pool-contract"
import { IntegrityTestHooks } from "../../src/integrity/team-agent"
import {
  INTEGRITY_DECLARED_TOOL_IDS,
  INTEGRITY_PREVIEW_TOOL_IDS,
  loadIntegrityPreviewToolInfos,
} from "../../src/integrity/static-tools"
import { Instance } from "../../src/project/instance"
import { ToolRegistry } from "../../src/tool/registry"
import { tmpdir } from "../fixture/fixture"

function reviewerReport(reviewerID: string) {
  return {
    reviewerID,
    scope: `${reviewerID} scope`,
    verdict: "pass",
    summary: `${reviewerID} passed.`,
    investigationPlan: {
      requestPromise: "The task must provide reference visual evidence.",
      hypothesis: "The submitted surface could lack required comparison evidence.",
      evidencePlan: ["Inspect visual evidence bundle."],
      passCriteria: ["Visual evidence bundle is present and passing."],
    },
    drilldowns: [
      {
        kind: "inspect_visual_evidence",
        target: "VisualEvidenceBundle",
        purpose: "Verify reference-comparison evidence.",
        result: "No issue found.",
      },
    ],
    coverage: [
      {
        userRequestQuote: "reference visual evidence",
        status: "covered",
        evidence: "Visual evidence inspected.",
      },
    ],
    evidence: ["Visual evidence inspected."],
    findings: [],
    openQuestions: [],
  }
}

function passConsensusReport() {
  return {
    verdict: "pass",
    summary: "Integrity passed.",
    teamReportMarkdown: "No blockers remain.",
    reviewers: [reviewerReport("reviewer_a"), reviewerReport("reviewer_b")],
    coverageAudit: [
      {
        promise: "Reference visual evidence was checked.",
        reviewerIDs: ["reviewer_a", "reviewer_b"],
        status: "covered",
        notes: "Both reviewers inspected the evidence.",
      },
    ],
    uninspectedRisks: [],
    findings: [],
    rounds: [],
    requiredRepairs: [],
    unresolvedDisagreements: [],
    fact_check_items: [],
  }
}

describe("integrity browser preview tool surface", () => {
  test("registry whitelist and runtime preview tools use the same definitions", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const agent = await Agent.get("integrity")
        expect(agent).toBeDefined()
        expect([...AgentToolPool.visibleToolIDs(agent?.tools)].sort()).toEqual([...INTEGRITY_DECLARED_TOOL_IDS].sort())

        const registryTools = await ToolRegistry.tools({ providerID: "", modelID: "" }, agent)
        expect(registryTools.map((item) => item.id).sort()).toEqual([...INTEGRITY_DECLARED_TOOL_IDS].sort())

        const kit = await IntegrityTestHooks.createSingleSessionIntegrityToolKit({
          collector: {},
          taskID: "tsk_integrity_preview_consistency",
          goals: [],
        })

        const toolInfos = await loadIntegrityPreviewToolInfos()
        expect(toolInfos.map((info) => info.id)).toEqual([...INTEGRITY_PREVIEW_TOOL_IDS])
        expect(toolInfos.map((info) => info.id)).not.toContain("skill")

        for (const info of toolInfos) {
          const initialized = await info.init()
          const runtimeTool = kit.tools[info.id] as unknown as {
            description?: string
            inputSchema?: unknown
            execute?: (args: unknown, options?: unknown) => Promise<unknown>
          }
          expect(runtimeTool.description).toBe(initialized.description)
          expect(runtimeTool.inputSchema).toBe(initialized.parameters)
        }
      },
    })
  }, 30_000)

  test("task-backed integrity reviews expose the preview repair toolchain", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const kit = await IntegrityTestHooks.createSingleSessionIntegrityToolKit({
          collector: {},
          taskID: "tsk_integrity_preview",
          goals: [],
        })

        for (const toolID of INTEGRITY_PREVIEW_TOOL_IDS) {
          expect(Object.keys(kit.tools)).toContain(toolID)
        }
        expect(Object.keys(kit.tools)).toContain("submit_integrity_consensus")
      },
    })
  })

  test("non-task integrity reviews do not expose task-scoped preview tools", async () => {
    const kit = await IntegrityTestHooks.createSingleSessionIntegrityToolKit({
      collector: {},
      goals: [],
    })

    for (const toolID of INTEGRITY_PREVIEW_TOOL_IDS) {
      expect(Object.keys(kit.tools)).not.toContain(toolID)
    }
    expect(Object.keys(kit.tools)).toContain("submit_integrity_consensus")
  })

  test("preview runtime tools require persisted session execution identity", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const kit = await IntegrityTestHooks.createSingleSessionIntegrityToolKit({
          collector: {},
          taskID: "tsk_integrity_preview_identity",
          goals: [],
        })
        const browserPreview = kit.tools.browser_preview as unknown as {
          execute: (args: unknown, options?: unknown) => Promise<unknown>
        }
        await expect(browserPreview.execute({ command: "npm run dev" }, {})).rejects.toThrow(
          "missing real tool execution identity",
        )
      },
    })
  })

  test("pass consensus is recorded with advisory when required visual evidence is missing", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const collector = {}
        const kit = await IntegrityTestHooks.createSingleSessionIntegrityToolKit({
          collector,
          taskID: "tsk_integrity_missing_visual_evidence",
          goals: [],
          projectRoot: tmp.path,
          visualEvidenceRequired: true,
        })
        const result = await kit.tools.submit_integrity_consensus.execute!(passConsensusReport(), {} as any)

        expect(String(result)).toContain("RECORDED")
        expect(String(result)).toContain("ADVISORIES")
        expect(String(result)).toContain("VisualEvidenceBundle")
        expect((collector as { report?: unknown }).report).toBeDefined()
      },
    })
  })
})
