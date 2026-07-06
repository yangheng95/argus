import { describe, expect, test } from "bun:test"
import {
  collectAgentOutcomesForTask,
  registerTaskAgentOutcomeProvider,
  type TaskAgentOutcome,
} from "../../src/agent/outcomes"

describe("task agent outcome provider registry", () => {
  test("collects outcomes from registered providers and removes them on dispose", () => {
    const outcome: TaskAgentOutcome = {
      id: "art_custom_outcome",
      provider: "custom-review",
      artifactKind: "custom_review_outcome",
      scope: "task",
      capabilities: ["review"],
      status: "completed",
      result: "accepted",
      summary: "custom review completed",
      time: { created: 1, updated: 2 },
    }

    const dispose = registerTaskAgentOutcomeProvider({
      id: "custom-review",
      collectOutcomesForTask(taskID) {
        return taskID === "tsk_registry" ? [outcome] : []
      },
    })

    expect(collectAgentOutcomesForTask("tsk_registry")).toContainEqual(outcome)
    expect(() =>
      registerTaskAgentOutcomeProvider({
        id: "custom-review",
        collectOutcomesForTask: () => [],
      }),
    ).toThrow("TaskAgentOutcomeProvider already registered")

    dispose()
    expect(collectAgentOutcomesForTask("tsk_registry")).not.toContainEqual(outcome)
  })
})
