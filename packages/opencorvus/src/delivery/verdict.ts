/**
 * Delivery verdict schema.
 *
 * Factored out of agent.ts so that output-tools.ts can consume the same Zod
 * shape for the mandatory `submit_verdict` tool without introducing a circular
 * import with agent.ts.
 */
import z from "zod"
import type { VisualMetricResult } from "./visual-metric"

export const StartupVerification = z.object({
  attempted: z.boolean().describe("Whether startup verification was attempted"),
  command: z.string().optional().describe("Command used to start the application"),
  success: z.boolean().describe("Whether the application started successfully"),
  output: z.string().optional().describe("Relevant startup output or error messages"),
})

export const FrontendCheck = z.object({
  attempted: z.boolean().describe("Whether frontend verification was attempted"),
  renders_correctly: z.boolean().optional().describe("Whether the frontend renders without errors"),
  issues: z.array(z.string()).optional().describe("Frontend issues found"),
})

/**
 * Evidence that a particular verification tool was actually called and what it
 * returned. Used to enforce skill `required_tools` contracts: a skill can
 * declare a tool MUST run (and pass) before verdict=accepted; submit_verdict
 * then checks every required tool is represented here with passed=true.
 *
 * `detail` is free-form but MUST let a reviewer reproduce the check — URL,
 * selector, response hash, exit code, etc. Prose like "checked the chart" is
 * rejected as non-evidentiary.
 */
export const ToolCallEvidence = z.object({
  tool: z.string().min(1).describe("Tool name as declared on the delivery tool set (e.g. 'verify_page_integrity', 'screenshot', 'run_command')."),
  passed: z.boolean().describe("Whether this invocation passed the check the tool performed. Tools that purely gather evidence without a pass/fail semantic must still set true/false based on whether they completed successfully."),
  target: z.string().optional().describe("The subject of the check — URL, endpoint, file path, command, selector. Populate whenever meaningful."),
  detail: z.string().min(1).describe("Reproducer-grade evidence: headline numbers + key signals the tool reported. NOT prose narration."),
  attachment_sha: z.string().optional().describe("SHA of any attachment (screenshot, log) produced by this call, for later inspection."),
})
export type ToolCallEvidenceType = z.infer<typeof ToolCallEvidence>

export const DeliveryVerdict = z.object({
  verdict: z.enum(["accepted", "rejected"]),
  summary: z.string().min(1),
  launch_command: z.string().optional().describe("The exact verified command to start the application (only present when startup_verification.success is true). Will be used to auto-launch after publish."),
  startup_verification: StartupVerification,
  frontend_check: FrontendCheck,
  issues_found: z.array(z.string()).default([]),
  /** The set of goal IDs the rejection attributes the failure to. The
   *  orchestrator uses this set directly to decide which goals to re-open
   *  via startNewAttempt — no downstream string-matching. Rule: when
   *  `verdict === "rejected"` this array MUST be non-empty; when
   *  `verdict === "accepted"` it is ignored (and normalized to [] by the
   *  submit_verdict tool). Each id must also be referenced by at least one
   *  rejection_details entry's `goal_id`, enforced at submit time. */
  affected_goal_ids: z.array(z.string()).default([]).describe(
    "Goal IDs this rejection blames. Required (non-empty) when verdict is rejected; must be a superset of all rejection_details[].goal_id values.",
  ),
  rejection_details: z.array(z.object({
    goal_id: z.string().describe("The goal id (gol_...) this rejection is attributed to. Must appear in affected_goal_ids."),
    category: z.enum(["build", "test", "lint", "runtime", "quality", "startup", "visual"]).describe("Category of the issue. Use 'visual' when the rejection traces back to a design_spec on task.design_specs."),
    file: z.string().optional().describe("Affected file path, if applicable"),
    error: z.string().describe("Description of the error or issue"),
    suggestion: z.string().optional().describe("Suggested fix approach for the executor"),
    visual_spec_id: z.string().optional().describe("Design-analyst spec id (vis-*) this rejection violates — cite when category='visual' and the violation maps to a specific design_spec entry on task.design_specs."),
  })).optional().describe("Structured rejection details for the executor to fix. Required when verdict is rejected."),
  deferred_checks: z.array(z.object({
    name: z.string().describe("Check name (e.g. code_review, dead_code_review)"),
    result: z.enum(["passed", "failed", "skipped"]),
    evidence: z.string().describe("Brief evidence or reason"),
  })).optional().describe("Extended checks that the evaluator deferred to delivery"),
  tool_call_evidence: z.array(ToolCallEvidence).default([]).describe(
    "Evidence that the mandatory verification tools ran. Every skill-declared required_tool must appear here with passed=true before verdict='accepted' is accepted. An empty list is only valid when no injected skill declared any required_tools.",
  ),
})

export type DeliveryVerdictType = z.infer<typeof DeliveryVerdict>

/**
 * 数值硬门（P0-B）对 LLM verdict 的最终裁定。
 *
 * 流程：LLM 先独立出 verdict，service 层再对 rendered.png + reference.png
 * 跑 `computeVisualMetric`。任一硬门未过 ⇒ finalizeVerdict 把 LLM 的
 * `accepted` 翻为 `rejected`，并把具体指标写进 rejection_details；LLM 无权
 * 推翻（CLAUDE.md rule 12：视觉有关的 benchmark 必须以视觉呈现）。
 *
 * 调用语义：
 *  - metric.passed === true  → 原封不动返回 LLM verdict（软性瑕疵由 LLM 判）
 *  - metric.passed === false + LLM verdict === "rejected" → 合并 gate 失败
 *    到 issues_found，保持 rejected
 *  - metric.passed === false + LLM verdict === "accepted" → 强制翻为 rejected
 *
 * `goalIds` 来源：调用方在 service 层传入 `input.goals.map(g => g.id)`。
 * 视觉硬门是 delivery 级失败，归因到全部 goal（任一 goal 都可能是 empty
 * skeleton 的产生源，由下游 executor 自查）。
 */
export function finalizeVerdict(
  llmVerdict: DeliveryVerdictType,
  metric: VisualMetricResult,
  goalIds: readonly string[],
): DeliveryVerdictType {
  if (metric.passed) return llmVerdict

  const failedGates = metric.gates.filter((g) => !g.passed)
  const gateErrorLines = failedGates.map(
    (g) => `[visual-gate/${g.name}] ${g.note}`,
  )
  const headline =
    `Numeric visual gate failed (score=${metric.score.toFixed(3)}). ` +
    `Rendered vs reference 在 ${failedGates.length} 条硬门上未达标，LLM 的 accept 被硬门覆盖。`

  const mergedIssues = Array.from(
    new Set([...(llmVerdict.issues_found ?? []), ...gateErrorLines]),
  )

  // LLM 本来就判 rejected：保留其归因，只追加硬门证据到 issues。
  if (llmVerdict.verdict === "rejected") {
    return {
      ...llmVerdict,
      issues_found: mergedIssues,
      summary: llmVerdict.summary
        ? `${llmVerdict.summary}\n\n${headline}`
        : headline,
    }
  }

  // LLM 判了 accepted，但硬门拒绝：强制翻转为 rejected。
  const visualRejection = failedGates.map((g) => ({
    goal_id: goalIds[0] ?? "unknown-goal",
    category: "visual" as const,
    error: `${g.name}: ${g.note || `value=${g.value} threshold=${g.threshold}`}`,
    suggestion:
      g.name === "chart_region_density" || g.name === "unique_color_ratio"
        ? "Render 结果过于接近空骨架——检查是否真的把数据渲染到了 DOM/canvas，而不是仅 scaffold。"
        : g.name === "phash_hamming" || g.name === "ssim"
          ? "整体布局/配色偏离 reference——对照 reference 重新对齐主要区块。"
          : "对照 reference_strings 检查关键文案是否渲染到位。",
  }))

  // 额外归因到每一个 goalId，便于 orchestrator 分配 repair（与 rejection_details[].goal_id 对齐）。
  const allGoalIds = goalIds.length > 0 ? [...goalIds] : ["unknown-goal"]
  const detailsPerGoal = allGoalIds.flatMap((gid) =>
    failedGates.map((g) => ({
      goal_id: gid,
      category: "visual" as const,
      error: `${g.name}: ${g.note || `value=${g.value} threshold=${g.threshold}`}`,
      suggestion: visualRejection[0]?.suggestion,
    })),
  )

  return {
    ...llmVerdict,
    verdict: "rejected",
    summary: `${headline}\n\nLLM 原 summary: ${llmVerdict.summary}`,
    issues_found: mergedIssues,
    affected_goal_ids: allGoalIds,
    rejection_details: [...(llmVerdict.rejection_details ?? []), ...detailsPerGoal],
  }
}
