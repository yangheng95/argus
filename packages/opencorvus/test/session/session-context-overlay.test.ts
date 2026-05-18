import { afterEach, describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { SessionContext } from "../../src/session/context"
import { tmpdir } from "../fixture/fixture"

function session(id: string, overlay: unknown) {
  return {
    id,
    slug: id,
    projectID: "project-test",
    directory: process.cwd(),
    title: id,
    version: "test",
    kind: "assistant",
    metadata: overlay === undefined ? undefined : { configOverlay: overlay },
    time: { created: Date.now(), updated: Date.now() },
  } as never
}

describe("SessionContext overlay isolation (Phase 3)", () => {
  afterEach(async () => {
    const { Agent } = await import("../../src/agent/agent")
    Agent.resetAll()
  })

  test("concurrent sessions keep independent overlays", async () => {
    const left = session("s-left", { model: "left/model" })
    const right = session("s-right", { model: "right/model" })

    const [leftModel, rightModel] = await Promise.all([
      SessionContext.provide(left, async () => {
        await Bun.sleep(5)
        const { resolveConfiguredModelRef } = await import("../../src/agent/model")
        return resolveConfiguredModelRef()
      }),
      SessionContext.provide(right, async () => {
        const { resolveConfiguredModelRef } = await import("../../src/agent/model")
        await Bun.sleep(10)
        return resolveConfiguredModelRef()
      }),
    ])

    expect(leftModel).toEqual({ providerID: "left", modelID: "model" })
    expect(rightModel).toEqual({ providerID: "right", modelID: "model" })
    expect(SessionContext.tryUse()).toBeUndefined()
  })

  test("Agent.state remains project-base only under a session overlay", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { Agent } = await import("../../src/agent/agent")
        Agent.reset()
        const overlay = {
          model: "overlay/top",
          agent: { coding: { model: "overlay/coding", prompt: "overlay prompt" } },
        }

        const inside = await SessionContext.provide(session("s-agent", overlay), () => Agent.get("coding"))
        const after = await Agent.get("coding")

        expect(inside?.model).toBeUndefined()
        expect(inside?.prompt).not.toBe("overlay prompt")
        expect(after?.model).toBeUndefined()
        expect(after?.prompt).toBe(inside?.prompt)
      },
    })
  })
})
