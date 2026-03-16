import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { OrchestratorInteractionActor } from "../../src/orchestrator/interaction-actor"
import { tmpdir } from "../fixture/fixture"

describe("orchestrator.interaction-actor", () => {
  test("serializes commands for the same key", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const order: string[] = []
        const gate = Promise.withResolvers<void>()

        const first = OrchestratorInteractionActor.submit("interaction:serial", async () => {
          order.push("first:start")
          await gate.promise
          order.push("first:end")
          return "first"
        })
        const second = OrchestratorInteractionActor.submit("interaction:serial", async () => {
          order.push("second:start")
          order.push("second:end")
          return "second"
        })

        await Bun.sleep(0)
        expect(order).toEqual(["first:start"])

        gate.resolve()

        await expect(first).resolves.toBe("first")
        await expect(second).resolves.toBe("second")
        expect(order).toEqual(["first:start", "first:end", "second:start", "second:end"])
      },
    })
  })
})
