import { afterEach, expect, test } from "bun:test"
import { mkdirSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createArchitectOutputTools } from "../src/architect/output-tools"
import { createRequirementsOutputTools } from "../src/requirements/output-tools"
import { createIntentOutputTools } from "../src/intent-analysis/output-tools"
import { createDesignOutputTools } from "../src/design-analyst/output-tools"
import { buildBuildAgentReport } from "../src/build/report"
import { buildGoalReport } from "../src/tool/goal-report"
import { AgentTrace } from "../src/trace"

const traceDir = join(tmpdir(), `opencorvus-agent-report-${process.pid}`)
process.env.OPENCORVUS_AGENT_TRACE_DIR = traceDir

afterEach(() => {
  rmSync(traceDir, { recursive: true, force: true })
})

function expectReport(report: { summary: string; detail: string }) {
  expect(report.summary.trim().length).toBeGreaterThan(0)
  expect(report.detail.trim().length).toBeGreaterThan(0)
  expect(report.summary.length).toBeLessThanOrEqual(280)
  expect(report.summary).not.toBe("(no summary)")
  expect(report.summary).not.toContain("3 requirements")
}

test("agent output toolkits build explicit non-empty reports", async () => {
  const architect = createArchitectOutputTools({ workDir: traceDir })
  const architectCollector = architect.getCollector()
  architectCollector.summary = "Coordinated workflow report cards."
  architectCollector.decomposition_analysis =
    "Split the work into a UI reporting goal with explicit ownership and verification boundaries so the build agent can execute without cross-goal ambiguity."
  architectCollector.goals.push({
    id: "goal_ui",
    title: "Readable workflow cards",
    objective: "Expose agent reports in the overlay with enough detail for operators to distinguish sessions.",
    acceptance_specs: [],
    owned_paths: ["packages/overlay/src/utils/agent-workflow.ts"],
    depends_on: [],
    exports: [],
    imports: [],
    priority: "blocking",
    kind: "feature",
    requirement_ids: ["REQ-1"],
  } as any)
  expectReport(architect.buildReport())

  const requirements = createRequirementsOutputTools()
  await requirements.tools.register_requirement.execute({
    id: "REQ-1",
    type: "explicit",
    description: "Show readable agent summaries.",
    acceptance: "Agent summaries are readable in the generated report.",
    non_goals: "This requirement does not cover visual styling of the report shell.",
  }, {} as any)
  await requirements.tools.register_decision.execute({ key: "ui_surface", value: "overlay", reason: "The user reads reports there." }, {} as any)
  await requirements.tools.submit_requirements.execute({ final: true }, {} as any)
  expectReport(requirements.buildReport())

  const intent = createIntentOutputTools()
  expectReport(intent.buildReport({
    structured: {
      intent_class: "feature",
      complexity: "medium",
      confidence: 0.9,
      summary: "Add explicit agent report summaries.",
    },
  }))

  const design = createDesignOutputTools()
  await design.tools.submit_design_prd_spec.execute({
    design_system: "OpenCorvus overlay",
    tech_stack: ["Solid"],
    product_spec: "# Agent workflow report\nReadable cards and reports.",
    frontend_spec: "Render report payloads directly.",
    visual_consistency_spec: "Keep cards compact and readable.",
    backend_spec: "Consume trace report payloads.",
    prd_iteration_notes: ["Checked report cards.", "Checked popover scroll."],
    completeness_review: "Complete for downstream implementation.",
    reference_artifacts: [],
    open_questions: [],
  }, {} as any)
  expectReport(design.buildReport())

  expectReport(buildBuildAgentReport({
    result: {
      status: "passed",
      summary: "Updated report rendering.",
      files_changed: [{ path: "src/app.ts", summary: "Read report payload.", reason: "Trace owns summaries." }],
      tests: [],
    },
  }))

  expectReport(buildGoalReport({
    implementation_approach: "Implemented the report contract by routing each agent summary through a single typed payload.",
    files_changed: [{ path: "src/app.ts", summary: "Read report payload." }],
    checks_run: [],
    design_decisions: [],
    blockers: [],
  }))
})

test("recordAgentReport writes the typed report payload", () => {
  mkdirSync(traceDir, { recursive: true })
  AgentTrace.recordAgentReport({
    sessionID: "ses_report_contract",
    taskID: "tsk_report_contract",
    agentName: "requirements",
    kind: "agent_report",
    collector: { requirements: [] },
    report: {
      summary: "Parsed explicit requirements.",
      detail: "## Requirements\n- REQ-1",
    },
  })

  const raw = readFileSync(
    join(traceDir, "tasks", "tsk_report_contract", "sessions", "ses_report_contract", "trace.jsonl"),
    "utf8",
  ).trim()
  const event = JSON.parse(raw)
  expect(event.payload.report).toEqual({
    summary: "Parsed explicit requirements.",
    detail: "## Requirements\n- REQ-1",
  })
  expect(event.payload.collector).toEqual({ requirements: [] })
})

test("runner report call sites pass explicit report payloads", () => {
  const source = readFileSync(join(import.meta.dir, "../src/agent/runner.ts"), "utf8")
  expect(source).toContain('kind: "agent_report_failure"')
  expect(source).toContain('kind: "agent_report"')
  expect(source).toContain('kind: "agent_report_retry_final"')
  expect(source.match(/report: buildTraceReport/g)?.length).toBeGreaterThanOrEqual(3)
  expect(source).toContain("report: lastReport")
})
