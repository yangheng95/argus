import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Agent } from "../../src/agent/agent"
import { Provider } from "../../src/provider/provider"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { createUserMessage } from "../../src/session/prompt/parts"
import { tmpdir } from "../fixture/fixture"

describe("session prompt model resolution", () => {
  afterEach(() => {
    mock.restore()
  })

  test("swallows only Provider.ModelNotFoundError during optional variant lookup", async () => {
    const stderr: string[] = []
    spyOn(Agent, "get").mockResolvedValue({ name: "test-agent", variant: "review" } as any)
    const write = spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
      stderr.push(String(chunk))
      return true
    }) as any)
    spyOn(Provider, "getModel").mockRejectedValueOnce(
      new Provider.ModelNotFoundError({
        providerID: "missing-provider",
        modelID: "missing-model",
        suggestions: ["deepseek/deepseek-v4-pro"],
      }),
    )

    await using tmp = await tmpdir({ git: true })
    const message = await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "assistant", title: "prompt parts model not found" })
        return createUserMessage({
          sessionID: session.id,
          agent: "test-agent",
          model: { providerID: "missing-provider", modelID: "missing-model" },
          parts: [{ type: "text", text: "hello" }],
        })
      },
    })

    expect(message.info.variant).toBeUndefined()
    expect(write).toHaveBeenCalled()
    expect(stderr.join("")).toContain("optional agent variant lookup failed")
  })

  test("rethrows non-ModelNotFoundError during optional variant lookup", async () => {
    const stderr: string[] = []
    spyOn(Agent, "get").mockResolvedValue({ name: "test-agent", variant: "review" } as any)
    const write = spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
      stderr.push(String(chunk))
      return true
    }) as any)
    spyOn(Provider, "getModel").mockRejectedValueOnce(new Error("provider registry unavailable"))

    await using tmp = await tmpdir({ git: true })
    await expect(
      Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({ kind: "assistant", title: "prompt parts unexpected error" })
          return createUserMessage({
            sessionID: session.id,
            agent: "test-agent",
            model: { providerID: "missing-provider", modelID: "missing-model" },
            parts: [{ type: "text", text: "hello" }],
          })
        },
      }),
    ).rejects.toThrow("provider registry unavailable")

    expect(write).toHaveBeenCalled()
    expect(stderr.join("")).toContain("optional agent variant lookup failed")
  })
})
