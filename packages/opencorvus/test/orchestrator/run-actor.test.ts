import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { OrchestratorRunActor } from "../../src/orchestrator/run-actor"
import { tmpdir } from "../fixture/fixture"

describe("orchestrator.run-actor", () => {
  test("serializes commands for the same run", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const order: string[] = []
        const gate = Promise.withResolvers<void>()

        const first = OrchestratorRunActor.submit("run_actor_serial", async () => {
          order.push("first:start")
          await gate.promise
          order.push("first:end")
          return "first"
        })
        const second = OrchestratorRunActor.submit("run_actor_serial", async () => {
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

  test("allows different runs to progress independently", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const order: string[] = []
        const gate = Promise.withResolvers<void>()

        const first = OrchestratorRunActor.submit("run_actor_a", async () => {
          order.push("a:start")
          await gate.promise
          order.push("a:end")
          return "a"
        })
        const second = OrchestratorRunActor.submit("run_actor_b", async () => {
          order.push("b:start")
          order.push("b:end")
          return "b"
        })

        await expect(second).resolves.toBe("b")
        expect(order).toEqual(["a:start", "b:start", "b:end"])

        gate.resolve()

        await expect(first).resolves.toBe("a")
        expect(order).toEqual(["a:start", "b:start", "b:end", "a:end"])
      },
    })
  })
})
