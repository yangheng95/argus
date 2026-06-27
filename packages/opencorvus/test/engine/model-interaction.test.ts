import { describe, expect, test } from "bun:test"
import { Interaction } from "../../src/engine/model"
import { Identifier } from "../../src/id/id"
import { timelineOrderKey } from "../../src/timeline/order"

describe("Interaction schema", () => {
  test("accepts task-level interactions without a run ID", () => {
    const interactionID = Identifier.ascending("interaction")
    const parsed = Interaction.parse({
      id: interactionID,
      taskID: Identifier.ascending("task"),
      orderKey: timelineOrderKey({
        domain: "interaction",
        time: 1,
        id: interactionID,
      }),
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
