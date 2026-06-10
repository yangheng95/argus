import { describe, expect, test } from "bun:test"
import { Interaction } from "../../src/engine/model"
import { Identifier } from "../../src/id/id"

describe("Interaction schema", () => {
  test("accepts task-level interactions without a run ID", () => {
    const parsed = Interaction.parse({
      id: Identifier.ascending("interaction"),
      taskID: Identifier.ascending("task"),
      runID: null,
      externalID: "question-1",
      type: "question",
      status: "pending",
      title: "Need input",
      body: "Choose one option.",
      time: {
        created: 1,
        updated: 1,
      },
    })

    expect(parsed.runID).toBeNull()
  })
})
