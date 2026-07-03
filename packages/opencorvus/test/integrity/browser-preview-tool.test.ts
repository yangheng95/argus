import { describe, expect, test } from "bun:test"
import { Agent } from "../../src/agent/agent"
import { AgentToolPool } from "../../src/agent/tool-pool-contract"
import { IntegrityTestHooks } from "../../src/integrity/team-agent"
import {
  INTEGRITY_DECLARED_TOOL_IDS,
  INTEGRITY_OUTPUT_TOOL_IDS,
  INTEGRITY_PREVIEW_TOOL_IDS,
  loadIntegrityPreviewToolInfos,
} from "../../src/integrity/static-tools"
import { Instance } from "../../src/project/instance"
import { ToolRegistry } from "../../src/tool/registry"
import { tmpdir } from "../fixture/fixture"

function reviewerReport(reviewerID: string) {
  const checkID = `check_${reviewerID}`
  return {
    reviewerID,
    checkIDs: [checkID],
    scope: `${reviewerID} scope`,
    verdict: "pass",
    summary: `${reviewerID} passed.`,
    investigationPlan: {
      requestPromise: "The task must provide a complete implementation for the requested surface.",
      hypothesis: "The submitted surface could hide implementation defects behind review prose.",
      evidencePlan: ["Inspect scoped implementation and Visual QA report context."],
      passCriteria: ["Implementation evidence and Visual QA context show no implementation defect."],
    },
    drilldowns: [
      {
        checkIDs: [checkID],
        kind: "inspect_integrity_evidence",
        target: "visual_qa_report",
        purpose: "Review Visual QA context for implementation defects.",
        result: "No issue found.",
      },
    ],
    coverage: [
      {
        checkIDs: [checkID],
        userRequestQuote: "complete implementation",
        status: "covered",
        evidence: "Implementation review evidence inspected.",
      },
    ],
    evidence: [{ checkIDs: [checkID], note: "Implementation review evidence inspected." }],
    openQuestions: [],
  }
}

function passConsensusReport() {
  return {
    verdict: "pass",
    summary: "Integrity passed.",
    teamReportMarkdown: "No blockers remain.",
    checkItems: [
      {
        id: "check_reviewer_a",
        reviewerID: "reviewer_a",
        category: "implementation",
        target: "visual_qa_report",
        question: "Does Visual QA context expose unresolved implementation defects?",
        status: "passed",
        expected: "No implementation defect remains in the scoped evidence.",
        observed: "Reviewers inspected implementation context and Visual QA report.",
        evidence: ["Implementation review evidence inspected."],
      },
      {
        id: "check_reviewer_b",
        reviewerID: "reviewer_b",
        category: "implementation",
        target: "visual_qa_report",
        question: "Does the second reviewer confirm implementation completeness?",
        status: "passed",
        expected: "No implementation defect remains in the scoped evidence.",
        observed: "Second reviewer inspected implementation context and Visual QA report.",
        evidence: ["Implementation review evidence inspected."],
      },
    ],
    reviewers: [reviewerReport("reviewer_a"), reviewerReport("reviewer_b")],
    coverageAudit: [
      {
        checkIDs: ["check_reviewer_a", "check_reviewer_b"],
        promise: "Implementation completeness was checked.",
        reviewerIDs: ["reviewer_a", "reviewer_b"],
        status: "covered",
        notes: "Both reviewers inspected implementation review evidence.",
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

async function submitRegisteredIntegrityReport(tools: Record<string, any>, report: ReturnType<typeof passConsensusReport>) {
  for (const item of report.checkItems) await tools.register_integrity_check_item.execute!(item, {})
  for (const row of report.reviewers) await tools.register_integrity_reviewer_report.execute!(row, {})
  for (const row of report.coverageAudit) await tools.register_integrity_coverage_audit.execute!(row, {})
  for (const row of report.uninspectedRisks) await tools.register_integrity_uninspected_risk.execute!(row, {})
  for (const row of report.findings) await tools.register_integrity_finding.execute!(row, {})
  for (const row of report.rounds) await tools.register_integrity_round.execute!(row, {})
  for (const row of report.requiredRepairs) await tools.register_integrity_required_repair.execute!(row, {})
  for (const row of report.unresolvedDisagreements) await tools.register_integrity_unresolved_disagreement.execute!(row, {})
  for (const row of report.fact_check_items) await tools.register_integrity_fact_check_item.execute!(row, {})
  return tools.submit_integrity_consensus.execute!(
    { verdict: report.verdict, summary: report.summary, teamReportMarkdown: report.teamReportMarkdown },
    {},
  )
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
          collector: IntegrityTestHooks.emptyConsensusCollector(),
          taskID: "tsk_integrity_preview_consistency",
          goals: [],
        })

        const toolInfos = await loadIntegrityPreviewToolInfos()
        expect(toolInfos.map((info) => info.id)).toEqual([...INTEGRITY_PREVIEW_TOOL_IDS])
        expect(toolInfos.map((info) => info.id)).not.toContain("skill")
        expect(toolInfos.map((info) => info.id)).not.toContain("browser_preview_compare_scroll_slices")

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

  test("task-backed integrity reviews expose runtime preview inspection without visual comparison tools", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const kit = await IntegrityTestHooks.createSingleSessionIntegrityToolKit({
          collector: IntegrityTestHooks.emptyConsensusCollector(),
          taskID: "tsk_integrity_preview",
          goals: [],
        })

        for (const toolID of INTEGRITY_PREVIEW_TOOL_IDS) {
          expect(Object.keys(kit.tools)).toContain(toolID)
        }
        expect(Object.keys(kit.tools)).not.toContain("browser_preview_compare_scroll_slices")
        for (const toolID of INTEGRITY_OUTPUT_TOOL_IDS) {
          expect(Object.keys(kit.tools)).toContain(toolID)
        }
      },
    })
  })

  test("non-task integrity reviews do not expose task-scoped preview tools", async () => {
    const kit = await IntegrityTestHooks.createSingleSessionIntegrityToolKit({
      collector: IntegrityTestHooks.emptyConsensusCollector(),
      goals: [],
    })

    for (const toolID of INTEGRITY_PREVIEW_TOOL_IDS) {
      expect(Object.keys(kit.tools)).not.toContain(toolID)
    }
    for (const toolID of INTEGRITY_OUTPUT_TOOL_IDS) {
      expect(Object.keys(kit.tools)).toContain(toolID)
    }
  })

  test("preview runtime tools require persisted session execution identity", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const kit = await IntegrityTestHooks.createSingleSessionIntegrityToolKit({
          collector: IntegrityTestHooks.emptyConsensusCollector(),
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

  test("pass consensus records without a legacy visual bundle host gate", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const collector = IntegrityTestHooks.emptyConsensusCollector()
        const kit = await IntegrityTestHooks.createSingleSessionIntegrityToolKit({
          collector,
          taskID: "tsk_integrity_missing_visual_feedback",
          goals: [],
          projectRoot: tmp.path,
        })
        const result = await submitRegisteredIntegrityReport(kit.tools, passConsensusReport())

        expect(String(result)).toContain("RECORDED: integrity review recorded with verdict=pass")
        expect(String(result)).not.toContain("inspect_visual_feedback_evidence")
        expect((collector as { report?: { verdict?: string } }).report?.verdict).toBe("pass")
      },
    })
  })
})
