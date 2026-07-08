import { afterEach, expect, test } from "bun:test"
import { mkdirSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createArchitectOutputTools } from "../src/architect/output-tools"
import { createRequirementsOutputTools } from "../src/requirements/output-tools"
import { createIntentOutputTools } from "../src/intent-analysis/output-tools"
import { createFrontendTemplateOutputTools } from "../src/frontend-design/output-tools"
import { buildBuildAgentReport } from "../src/build/report"
import { buildGoalReport } from "../src/tool/goal-report"
import { ProjectRuntimePaths } from "../src/project/runtime-paths"

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
  await requirements.tools.register_requirement.execute(
    {
      id: "REQ-1",
      type: "explicit",
      description: "Show readable agent summaries.",
      acceptance: "Agent summaries are readable in the generated report.",
      non_goals: "This requirement does not cover visual styling of the report shell.",
      evidence_refs: [],
    },
    {} as any,
  )
  await requirements.tools.register_decision.execute(
    { key: "ui_surface", value: "overlay", reason: "The user reads reports there." },
    {} as any,
  )
  await requirements.tools.submit_requirements.execute({ final: true }, {} as any)
  expectReport(requirements.buildReport())

  const intent = createIntentOutputTools()
  expectReport(
    intent.buildReport({
      structured: {
        intent_class: "feature",
        complexity: "medium",
        confidence: 0.9,
        summary: "Add explicit agent report summaries.",
      },
    }),
  )

  const design = createFrontendTemplateOutputTools()
  await design.tools.update_frontend_basics.execute(
    {
      design_system: "OpenCorvus overlay",
      tech_stack: ["Solid"],
      final_acceptance_mode: "visual_baseline_allowed",
    },
    {} as any,
  )
  await design.tools.update_frontend_text.execute(
    { section: "frontend_template", content: "# Agent workflow report\nReadable cards and reports." },
    {} as any,
  )
  await design.tools.update_frontend_text.execute(
    { section: "fillable_modules", content: "Render report payloads directly." },
    {} as any,
  )
  await design.tools.update_frontend_text.execute(
    { section: "component_inventory", content: "Report card and popover components." },
    {} as any,
  )
  await design.tools.update_frontend_component_reuse.execute(
    {
      family_id: "comp-report-card",
      name: "Report card",
      observed_surface: "Overlay report card",
      source_refs: ["packages/overlay/src/components/Card.tsx"],
      implementation_strategy: "existing_project_component",
      reuse_source: "packages/overlay/src/components/Card.tsx",
      mature_library_candidates: [],
      props_states: "summary, detail, expanded state",
      replacement_boundary: "report card body",
      parity_guard: "overlay report card remains compact and readable",
    },
    {} as any,
  )
  await design.tools.update_frontend_text.execute(
    { section: "material_inventory", content: "Trace report payload samples." },
    {} as any,
  )
  await design.tools.update_frontend_material.execute(
    {
      title: "Trace payload samples",
      detail: "Use trace report payload samples to verify report card rendering.",
      source_refs: ["packages/overlay/src/components/Card.tsx"],
    },
    {} as any,
  )
  await design.tools.update_frontend_text.execute(
    { section: "visual_consistency_contract", content: "Keep cards compact and readable." },
    {} as any,
  )
  await design.tools.update_frontend_text.execute(
    { section: "ui_data_contract", content: "Consume trace report payloads." },
    {} as any,
  )
  await design.tools.update_frontend_iteration_note.execute({ value: "Checked report cards." }, {} as any)
  await design.tools.update_frontend_iteration_note.execute({ value: "Checked popover scroll." }, {} as any)
  await design.tools.update_frontend_text.execute(
    { section: "completeness_review", content: "Complete for downstream implementation." },
    {} as any,
  )
  await design.tools.submit_frontend_template.execute({ final: true }, {} as any)
  expectReport(design.buildReport())

  expectReport(
    buildBuildAgentReport({
      result: {
        status: "passed",
        summary: "Updated report rendering.",
        contract_restatement:
          "Implemented the report rendering request for overlay agent report cards and left visual styling outside this build.",
        followup_workload_guidance:
          "Follow-up agents should inspect overlay report payload volume before estimating additional report work.",
        files_changed: [{ path: "src/app.ts", summary: "Read report payload.", reason: "Trace owns summaries." }],
        tests: [],
      },
    }),
  )

  expectReport(
    buildGoalReport({
      implementation_approach:
        "Implemented the report contract by routing each agent summary through a single typed payload.",
      files_changed: [{ path: "src/app.ts", summary: "Read report payload." }],
      checks_run: [],
      design_decisions: [],
      blockers: [],
      followup_workload_guidance:
        "Follow-up agents should read trace payload examples before expanding report UI scope.",
    }),
  )
})

test("agent reports surface workload handoff guidance", () => {
  const build = buildBuildAgentReport({
    result: {
      status: "passed",
      summary: "Implemented the handoff fields.",
      contract_restatement: "Handled the detailed request to preserve req/goal complexity in build reports.",
      followup_workload_guidance:
        "Subsequent agents must re-read workload evidence before planning more report changes.",
      files_changed: [],
      tests: [],
    },
  })
  expect(build.detail).toContain("## Contract Restatement")
  expect(build.detail).toContain("preserve req/goal complexity")
  expect(build.detail).toContain("## Follow-up Workload Guidance")
  expect(build.detail).toContain("re-read workload evidence")

  const goal = buildGoalReport({
    implementation_approach:
      "Implemented the goal report handoff by preserving hidden workload guidance in the structured report detail.",
    files_changed: [],
    checks_run: [],
    design_decisions: [],
    blockers: [],
    followup_workload_guidance:
      "Subsequent agents should inspect the goal workload brief before adding more executor report fields.",
  })
  expect(goal.detail).toContain("## Follow-up Workload Guidance")
  expect(goal.detail).toContain("goal workload brief")
})

test("recordAgentReport writes the typed report payload", async () => {
  mkdirSync(traceDir, { recursive: true })
  const { AgentTrace } = await import("../src/trace")
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
    ProjectRuntimePaths.tracePathFromRuntimeRoot(
      AgentTrace.getTraceDir(),
      "tsk_report_contract",
      "ses_report_contract",
    ),
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
  expect(source).toContain("const failureReport = buildTraceReport")
  expect(source).toContain("summary: failureReport.summary")
  expect(source).toMatch(/successReport\s*=\s*buildTraceReport/)
  expect(source).toContain("summary: successReport.summary")
  expect(source).toContain("report: failureReport")
  expect(source).toContain("report: successReport")
  expect(source).toMatch(/report:\s*lastReport\s*\?\?\s*errorReport/)
})

test("Task tool terminal summaries come from child output or explicit terminal errors", () => {
  const source = readFileSync(join(import.meta.dir, "../src/tool/task.ts"), "utf8")
  expect(source).toContain('import { paragraphSummary } from "@/agent/report"')
  expect(source).toContain("summary: paragraphSummary(error)")
  expect(source).toContain("Task subagent ${session.id} completed without a text result")
  expect(source).toContain('reason: "completed", summary: paragraphSummary(text)')
  expect(source).not.toContain('summary: "(no summary)"')
})
