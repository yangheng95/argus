import { describe, expect, test } from "bun:test"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionCompaction } from "../../src/session/compaction"
import { tmpdir } from "../fixture/fixture"

describe("SessionCompaction continuation", () => {
  test("does not expose a user-message continuation builder", () => {
    expect("buildContinueUserMessage" in SessionCompaction).toBe(false)
  })

  test("creates compaction continuation from the source user prompt contract", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "assistant", title: "compaction inheritance" })
        const source = await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "provider-a", modelID: "model-a" },
          format: {
            type: "json_schema",
            schema: {
              type: "object",
              properties: { status: { type: "string" } },
              required: ["status"],
            },
            retryCount: 1,
          },
          system: "stage system prompt",
          systemMode: "complete",
          tools: { edit: true, bash: false },
          variant: "xhigh",
          extra: { goalID: "gol_compaction_contract" },
        })
        expect(source.role).toBe("user")
        if (source.role !== "user") return

        await SessionCompaction.create({
          sessionID: session.id,
          source,
          auto: true,
          overflow: false,
        })

        const messages = await Session.messages({ sessionID: session.id })
        const compaction = messages.find((msg) => msg.parts.some((part) => part.type === "compaction"))
        expect(compaction?.info.role).toBe("user")
        if (compaction?.info.role !== "user") return

        expect(compaction.info.agent).toBe("build")
        expect(compaction.info.model).toEqual({ providerID: "provider-a", modelID: "model-a" })
        expect(compaction.info.format?.type).toBe("json_schema")
        expect(compaction.info.system).toBe("stage system prompt")
        expect(compaction.info.systemMode).toBe("complete")
        expect(compaction.info.tools).toEqual({ edit: true, bash: false })
        expect(compaction.info.variant).toBe("xhigh")
        expect(compaction.info.extra).toEqual({ goalID: "gol_compaction_contract" })
      },
    })
  })

  test("persists an explicit compaction model override on the compaction message", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "assistant", title: "compaction model override" })
        const source = await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "provider-a", modelID: "model-a" },
        })
        expect(source.role).toBe("user")
        if (source.role !== "user") return

        await SessionCompaction.create({
          sessionID: session.id,
          source,
          model: { providerID: "provider-b", modelID: "model-b" },
          auto: false,
          overflow: false,
        })

        const messages = await Session.messages({ sessionID: session.id })
        const compaction = messages.find((msg) => msg.parts.some((part) => part.type === "compaction"))
        expect(compaction?.info.role).toBe("user")
        if (compaction?.info.role !== "user") return

        expect(compaction.info.model).toEqual({ providerID: "provider-b", modelID: "model-b" })
      },
    })
  })
})
