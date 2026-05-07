import { describe, expect, test } from "bun:test"
import "../../src/session/prompt"
import { tool } from "ai"
import z from "zod"
import { SessionLoop } from "../../src/session/loop"
import { INTEGRITY_DIMENSIONS } from "../../src/integrity/dimensions"

/**
 * Regression test for specs/new-arch/2026-04-28-structured-output-systemic-fix.md
 * §A + §G: the integrity reviewer's tool kit must fit comfortably inside
 * the kimi-k2.5 input budget once measured with the provider-normalized
 * estimator. Before Phase A's estimator fix, the inline `JSON.stringify
 * (zodWrapper)` call was reporting 992 KB / 258 K tokens (≈ 99% of the
 * 262 K kimi budget) and pre-empting integrity step 1 with
 * `predictive-compaction-triggered`. The actual provider-bound JSON
 * Schema payload is two orders of magnitude smaller; this test makes
 * that invariant a regression target.
 *
 * If a future change to `INTEGRITY_DIMENSIONS` or the verdict-tool
 * shape pushes payload over the threshold, the spec's §G escalation
 * (split `submit_<dim>_verdict` into per-dimension issue/correction/
 * missing-goal tools) becomes structurally necessary, not optional.
 */
describe("integrity reviewer tool payload — provider-normalised budget", () => {
  // Mirror integrity/agent.ts:buildDimensionInput exactly. Kept inline so
  // a future change to that builder does not silently bypass this guard.
  const VerdictEnum = z.enum(["pass", "concerns", "needs_correction"])
  const GoalCorrectionUpdates = z.object({
    title: z.string().optional(),
    objective: z.string().optional(),
    owned_paths: z.array(z.string()).optional(),
    depends_on: z.array(z.string()).optional(),
    exports: z.array(z.string()).optional(),
    imports: z.array(z.string()).optional(),
    kind: z.enum(["bootstrap", "feature", "verification", "integration", "system"]).optional(),
    priority: z.enum(["blocking", "advisory"]).optional(),
    requirement_ids: z.array(z.string()).optional(),
  })
  const GoalCorrectionInput = z.object({
    action: z.enum(["modify", "split", "remove"]),
    goal_id: z.string().min(1),
    reason: z.string().min(1),
    updates: GoalCorrectionUpdates.optional(),
  })
  const MissingGoalInput = z.object({
    title: z.string().min(1),
    objective: z.string().min(1),
    acceptance_spec_hints: z.array(z.string().min(1)).min(1),
    owned_paths: z.array(z.string()).min(1),
    kind: z.enum(["bootstrap", "feature", "verification", "integration", "system"]),
    priority: z.enum(["blocking", "advisory"]),
    reason: z.string().min(1),
  })

  function buildIssueInput(d: (typeof INTEGRITY_DIMENSIONS)[number]) {
    const types = d.issueTypes as readonly string[]
    return z.object({
      type: z.enum(types as [string, ...string[]]),
      description: z.string().min(1),
      goal_ids: z.array(z.string()).optional(),
      evidence: z.string().optional(),
    })
  }

  function buildDimensionInput(d: (typeof INTEGRITY_DIMENSIONS)[number]) {
    const issue = buildIssueInput(d)
    if (d.canProposeCorrections) {
      return z.object({
        verdict: VerdictEnum,
        issues: z.array(issue),
        corrections: z.array(GoalCorrectionInput),
        missing_goals: z.array(MissingGoalInput),
      })
    }
    return z.object({
      verdict: VerdictEnum,
      issues: z.array(issue),
    })
  }

  function buildToolKit(): Record<string, unknown> {
    // Mirror integrity/agent.ts:301-364 verbatim: production passes the raw
    // Zod schema to `tool({inputSchema: ...})` (NOT pre-wrapped via
    // `jsonSchema(...)`). This is the shape that exposes the internal Zod
    // `_def` graph to the old stringify-based estimator and produced the
    // 992K char ghost in ainvest-20260428-100538.
    const tools: Record<string, unknown> = {}
    for (const d of INTEGRITY_DIMENSIONS) {
      tools[`submit_${d.id}_verdict`] = tool({
        description: `Submit the ${d.title} (${d.id}) dimension verdict.`,
        inputSchema: buildDimensionInput(d),
        async execute() {
          return { output: "", title: "", metadata: {} }
        },
      })
    }
    const StructuredFinal = z.object({ summary: z.string().min(1) })
    tools["StructuredOutput"] = SessionLoop.createStructuredOutputTool({
      schema: z.toJSONSchema(StructuredFinal) as Record<string, unknown>,
      onSuccess: () => undefined,
    })
    return tools
  }

  test("normalized payload stays under 50% of kimi-k2.5's input budget (262K tokens)", () => {
    const tools = buildToolKit() as Parameters<typeof SessionLoop.estimateToolPayloadChars>[0]
    const chars = SessionLoop.estimateToolPayloadChars(tools)

    // 262144 tokens × 4 chars/token × 0.5 default ToolSchemaBudgetRatio
    const charsBudget = 262_144 * 4 * 0.5
    expect(chars).toBeLessThan(charsBudget)

    // Sanity bound: this test was added when the measurement was 6,671 chars.
    // Anything over 50,000 indicates the verdict schemas have grown an order
    // of magnitude — flag for §G refactor before merging.
    expect(chars).toBeLessThan(50_000)

    // Lower bound: dropping below 1 KB means we lost the dimension tools
    // (e.g. the registry was emptied or buildDimensionInput silently no-op'd).
    expect(chars).toBeGreaterThan(1_000)
  })

  test("the old Zod-stringify estimate inflates the payload (regression target)", () => {
    // Document what the estimator MUST NOT do: stringify the raw
    // tool.inputSchema wrapper. For raw-Zod-backed tools (the production
    // shape — see integrity/agent.ts:301-364), `JSON.stringify(wrapper)`
    // walks the Zod object and emits at least the `_def` graph, which is
    // strictly larger than the wire-bound JSON Schema. We assert the
    // wrapper-stringified size is at least 3× the provider-normalised size
    // to confirm the inflation is real and the estimator's switch
    // mattered. Exact ratios depend on how deeply the dimension schemas
    // nest; on the 2026-04-28 benchmark with the original AcceptanceSpec
    // tree included it was ~150×, today (post 69714dae6 swap) it is ~5×.
    const tools = buildToolKit() as Record<string, { inputSchema: unknown; description?: unknown }>
    const normalized = SessionLoop.estimateToolPayloadChars(
      tools as Parameters<typeof SessionLoop.estimateToolPayloadChars>[0],
    )

    let zodWrapperBytes = 0
    for (const [name, t] of Object.entries(tools)) {
      try {
        zodWrapperBytes += JSON.stringify({
          name,
          description: t.description,
          inputSchema: t.inputSchema,
        }).length
      } catch {
        // some Zod wrappers contain functions and stringify partially; that's
        // fine for this comparative measurement.
      }
    }

    expect(zodWrapperBytes).toBeGreaterThan(normalized * 3)
  })
})
