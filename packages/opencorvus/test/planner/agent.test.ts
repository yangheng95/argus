import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { planGoal } from "../../src/planner/agent"
import { AgentRuntime } from "../../src/agent/runtime/runtime"
import * as AgentModel from "../../src/agent/model"
import { Instance } from "../../src/project/instance"

function contract() {
  return {
    goal: {
      id: "goal_test",
      title: "Test goal",
      objective: "Implement the goal.",
      acceptance_specs: [],
      owned_paths: ["src/test.ts"],
      depends_on: [],
      priority: "blocking",
      kind: "feature",
      requirement_ids: [],
      exports: [],
      imports: [],
    },
    planNode: null,
    run: { id: "run_1" },
    task: { id: "tsk_1", title: "task", request: "user request text" },
    plan: { id: "plan_1" },
    dependencies: [],
  } as any
}

describe("planGoal", () => {
  afterEach(() => {
    mock.restore()
  })

  test("returns the structured plan submitted via submit_plan", async () => {
    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        spyOn(AgentModel, "resolveAgentModel").mockResolvedValue({
          id: "test/mock",
          providerID: "test",
          modelID: "mock",
        } as any)

        spyOn(AgentRuntime, "run").mockImplementation(async (input: any) => {
          await input.tools.submit_plan.execute({
            title: "Planner title",
            brief: "1. Inspect src/test.ts.\n2. Apply the change.\n3. Run verification.",
            file_actions: [{ path: "src/test.ts", intent: "Implement the goal in the owned file." }],
            verification_commands: [{ command: "bun test", purpose: "Validate the goal behavior." }],
          })
          return {
            text: "",
            steps: [{ toolCalls: [{ toolName: "submit_plan" }] }],
            finishReason: "tool-calls",
            toolCallCount: 1,
            failures: { count: 0, items: [] },
          }
        })

        const result = await planGoal({ contract: contract() })
        expect(result).toEqual({
          title: "Planner title",
          brief: "1. Inspect src/test.ts.\n2. Apply the change.\n3. Run verification.",
          file_actions: [{ path: "src/test.ts", intent: "Implement the goal in the owned file." }],
          verification_commands: [{ command: "bun test", purpose: "Validate the goal behavior." }],
        })
      },
    })
  })

  test("fails when submit_plan is not called", async () => {
    await Instance.provide({
      directory: process.cwd(),
      fn: async () => {
        spyOn(AgentModel, "resolveAgentModel").mockResolvedValue({
          id: "test/mock",
          providerID: "test",
          modelID: "mock",
        } as any)

        spyOn(AgentRuntime, "run").mockResolvedValue({
          text: "ignored plain text",
          steps: [],
          finishReason: "stop",
          toolCallCount: 0,
          failures: { count: 0, items: [] },
        } as any)

        await expect(planGoal({ contract: contract() })).rejects.toThrow("did not call submit_plan")
      },
    })
  })
})