import { describe, expect, test } from "bun:test"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionCompaction } from "../../src/session/compaction"
import { SessionControl } from "../../src/session/control"
import { tmpdir } from "../fixture/fixture"

describe("SessionCompaction continuation", () => {
  test("does not expose a user-message continuation builder", () => {
    expect("buildContinueUserMessage" in SessionCompaction).toBe(false)
  })

  test("creates compaction request as a session control record without copying the user prompt contract", async () => {
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
        expect(compaction).toBeUndefined()

        const controls = SessionControl.pending(session.id)
        expect(controls).toHaveLength(1)
        expect(controls[0].kind).toBe("compaction_request")
        expect(controls[0].payload).toEqual({
          source_user_message_id: source.id,
          model: undefined,
          overflow: false,
          focus: undefined,
        })
      },
    })
  })

  test("persists an explicit compaction model override on the control record only", async () => {
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
        expect(compaction).toBeUndefined()

        const controls = SessionControl.pending(session.id)
        expect(controls).toHaveLength(1)
        expect(controls[0].kind).toBe("manual_summarize")
        expect(controls[0].payload.model).toEqual({ providerID: "provider-b", modelID: "model-b" })
      },
    })
  })

  for (const kind of ["build", "frontend-design", "integrity"] as const) {
    test(`rejects queued automatic compaction for ${kind} workflow sessions`, async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({ kind, title: `${kind} auto compaction` })
          const source = await Session.updateMessage({
            id: Identifier.ascending("message"),
            sessionID: session.id,
            role: "user",
            time: { created: Date.now() },
            agent: kind,
            model: { providerID: "provider-a", modelID: "model-a" },
          })
          expect(source.role).toBe("user")
          if (source.role !== "user") return

          await expect(
            SessionCompaction.create({
              sessionID: session.id,
              source,
              auto: true,
              overflow: true,
            }),
          ).rejects.toThrow(`Automatic compaction is disabled for workflow session kind ${kind}`)

          expect(SessionControl.pending(session.id)).toEqual([])
        },
      })
    })
  }

  test("allows manual summarize for build sessions", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "build", title: "workflow manual summarize" })
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
          auto: false,
          overflow: true,
        })

        const controls = SessionControl.pending(session.id)
        expect(controls).toHaveLength(1)
        expect(controls[0].kind).toBe("manual_summarize")
      },
    })
  })
})
