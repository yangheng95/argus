import { describe, expect, test } from "bun:test"
import { Agent } from "../../src/agent/agent"
import { deliveryAgentSystem } from "../../src/delivery/agent"
import { Instance } from "../../src/project/instance"
import { SessionContext } from "../../src/session/context"
import { tmpdir } from "../fixture/fixture"

describe("deliveryAgentSystem session agent overlay", () => {
  test("uses resolveSessionAgent for session-scoped prompt_append", async () => {
    await using tmp = await tmpdir({
      config: {
        agent: {
          delivery: { prompt_append: "base delivery append" },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const baseAgent = await Agent.get("delivery")
        expect(baseAgent?.promptAppend).toBe("base delivery append")

        const result = await SessionContext.provide(
          {
            id: "session_delivery_overlay",
            metadata: {
              configOverlay: {
                agent: {
                  delivery: { prompt_append: "session delivery append" },
                },
              },
            },
          } as never,
          () => deliveryAgentSystem(),
        )

        expect(result.prompt).toContain("session delivery append")
        expect(result.prompt).not.toContain("base delivery append")
      },
    })
  })
})
