import { afterEach, expect, mock, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

let runnerImpl: ((input: any) => Promise<any>) | undefined

mock.module("@/agent/runner", () => ({
  runAgentSession: (input: any) => {
    if (!runnerImpl) throw new Error("runAgentSession mock not configured")
    return runnerImpl(input)
  },
  runAgentSessionWithRetry: () => {
    throw new Error("runAgentSessionWithRetry should not be called by ArchitectAgent")
  },
}))

afterEach(async () => {
  runnerImpl = undefined
  mock.restore()
  await Instance.disposeAll()
})

test("ArchitectAgent registers submit_architect as the terminal collector contract", async () => {
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      runnerImpl = async (input: any) => {
        expect(input.format).toBeUndefined()
        expect(input.terminalTool?.toolName).toBe("submit_architect")
        expect(input.terminalTool?.isSatisfied(input.toolKit.getCollector())).toBe(false)
        expect(input.terminalTool?.shouldExposeOnlyTerminalTool(input.toolKit.getCollector())).toBe(false)

        const collector = input.toolKit.getCollector()
        collector.summary = "Single goal decomposition"
        collector.goals.push({
          id: "goal_main",
          title: "Main implementation",
          objective: "Implement the requested change with focused verification.",
          acceptance_specs: [],
          owned_paths: ["src/index.ts"],
          depends_on: [],
          exports: [],
          imports: [],
          priority: "blocking",
          kind: "feature",
          requirement_ids: ["REQ-1"],
        })
        for (const name of [
          "functional_correctness",
          "scenario_coverage",
          "contract_compliance",
          "regression_count",
        ]) {
          collector.goal_metric_specs.push({
            goal_id: "goal_main",
            name,
            description: `${name} must pass`,
            unit: "ratio",
            direction: "higher_better",
            target: 1,
            floor: 0.8,
            weight: 1,
            gate_class: "blocking",
            evaluator_kind: "judge",
            evaluator_config: {},
            source_requirement_ids: ["REQ-1"],
          })
        }
        for (const name of [
          "cross_goal_contract_consistency",
          "non_regression_surface",
          "architecture_integrity",
          "user_intent_fidelity",
        ]) {
          collector.global_metric_specs.push({
            name,
            description: `${name} must pass`,
            unit: "ratio",
            direction: "higher_better",
            target: 1,
            floor: 0.8,
            weight: 1,
            gate_class: "blocking",
            evaluator_kind: "judge",
            evaluator_config: {},
            source_requirement_ids: ["REQ-1"],
          })
        }

        expect(input.terminalTool.shouldExposeOnlyTerminalTool(input.toolKit.getCollector())).toBe(true)
        collector.finalized = true
        expect(input.terminalTool.isSatisfied(input.toolKit.getCollector())).toBe(true)
        return {
          session: { id: "ses_architect" },
          finalMessage: { info: {} },
          collector,
          structured: undefined,
          streamErrors: [],
          model: { providerID: "test", modelID: "mock", id: "test/mock" },
          requiredTools: [],
        }
      }

      const { ArchitectAgent } = await import("../../src/architect/agent")
      const result = await ArchitectAgent.coordinate({
        goals: [],
        taskRequest: "Change the app",
        taskTitle: "Change app",
        requirements: [{ id: "REQ-1", type: "explicit", description: "Change the app" }],
        requirementDecisions: [],
        decisionLog: {
          append() {},
          toPromptSection() {
            return ""
          },
        } as any,
      })

      expect(result.sessionID).toBe("ses_architect")
      expect(result.goals.map((goal) => goal.id)).toEqual(["goal_main"])
    },
  })
}, 30_000)
