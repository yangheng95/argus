import path from "path"
import { describe, expect, test } from "bun:test"
import { fileURLToPath } from "url"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message"
import { SessionPrompt } from "../../src/session/prompt"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("session.prompt missing file", () => {
  test("does not fail the prompt when a file part is missing", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          build: {
            model: "openai/gpt-5.2",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})

        const missing = path.join(tmp.path, "does-not-exist.ts")
        const msg = await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          noReply: true,
          parts: [
            { type: "text", text: "please review @does-not-exist.ts" },
            {
              type: "file",
              mime: "text/plain",
              url: `file://${missing}`,
              filename: "does-not-exist.ts",
            },
          ],
        })

        if (msg.info.role !== "user") throw new Error("expected user message")

        const hasFailure = msg.parts.some(
          (part) => part.type === "text" && part.synthetic && part.text.includes("Read tool failed to read"),
        )
        expect(hasFailure).toBe(true)

        await Session.remove(session.id)
      },
    })
  }, 20000)

  test("keeps stored part order stable when file resolution is async", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          build: {
            model: "openai/gpt-5.2",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})

        const missing = path.join(tmp.path, "still-missing.ts")
        const msg = await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          noReply: true,
          parts: [
            {
              type: "file",
              mime: "text/plain",
              url: `file://${missing}`,
              filename: "still-missing.ts",
            },
            { type: "text", text: "after-file" },
          ],
        })

        if (msg.info.role !== "user") throw new Error("expected user message")

        const stored = await MessageV2.get({
          sessionID: session.id,
          messageID: msg.info.id,
        })
        const text = stored.parts.filter((part) => part.type === "text").map((part) => part.text)

        expect(text[0]?.startsWith("Called the Read tool with the following input:")).toBe(true)
        expect(text[1]?.includes("Read tool failed to read")).toBe(true)
        expect(text[2]).toBe("after-file")

        await Session.remove(session.id)
      },
    })
  }, 20000)
})

describe("session.prompt special characters", () => {
  test("handles filenames with # character", async () => {
    const prev = process.env.OPENAI_API_KEY
    process.env.OPENAI_API_KEY = "test-openai-key"

    try {
      await using tmp = await tmpdir({
        git: true,
        init: async (dir) => {
          await Bun.write(path.join(dir, "file#name.txt"), "special content\n")
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({})
          const template = "Read @file#name.txt"
          const parts = await SessionPrompt.resolvePromptParts(template)
          const fileParts = parts.filter((part) => part.type === "file")

          expect(fileParts.length).toBe(1)
          expect(fileParts[0].filename).toBe("file#name.txt")
          expect(fileParts[0].url).toContain("%23")

          const decodedPath = fileURLToPath(fileParts[0].url)
          expect(decodedPath).toBe(path.join(tmp.path, "file#name.txt"))

          const message = await SessionPrompt.prompt({
            sessionID: session.id,
            model: { providerID: "openai", modelID: "gpt-5.2" },
            parts,
            noReply: true,
          })
          const stored = await MessageV2.get({ sessionID: session.id, messageID: message.info.id })
          const textParts = stored.parts.filter((part) => part.type === "text")
          const hasContent = textParts.some((part) => part.text.includes("special content"))
          expect(hasContent).toBe(true)

          await Session.remove(session.id)
        },
      })
    } finally {
      if (prev === undefined) delete process.env.OPENAI_API_KEY
      else process.env.OPENAI_API_KEY = prev
    }
  }, 20000)
})

describe("session.prompt agent variant", () => {
  test("applies agent variant only when using agent model", async () => {
    const prev = process.env.OPENAI_API_KEY
    process.env.OPENAI_API_KEY = "test-openai-key"

    try {
      await using tmp = await tmpdir({
        git: true,
        config: {
          agent: {
            build: {
              model: "openai/gpt-5.2",
              variant: "xhigh",
            },
          },
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({})

          const other = await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "build",
            model: { providerID: "opencorvus", modelID: "kimi-k2.5-free" },
            noReply: true,
            parts: [{ type: "text", text: "hello" }],
          })
          if (other.info.role !== "user") throw new Error("expected user message")
          expect(other.info.variant).toBeUndefined()

          const match = await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "build",
            noReply: true,
            parts: [{ type: "text", text: "hello again" }],
          })
          if (match.info.role !== "user") throw new Error("expected user message")
          expect(match.info.model).toEqual({ providerID: "openai", modelID: "gpt-5.2" })
          expect(match.info.variant).toBe("xhigh")

          const override = await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "build",
            noReply: true,
            variant: "high",
            parts: [{ type: "text", text: "hello third" }],
          })
          if (override.info.role !== "user") throw new Error("expected user message")
          expect(override.info.variant).toBe("high")

          await Session.remove(session.id)
        },
      })
    } finally {
      if (prev === undefined) delete process.env.OPENAI_API_KEY
      else process.env.OPENAI_API_KEY = prev
    }
  }, 20000)
})

describe("session.prompt plan mode reminders", () => {
  test("injects the plan-mode reminder when entering plan mode", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const msg = await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "plan",
          model: { providerID: "openai", modelID: "gpt-5.2" },
          noReply: true,
          parts: [{ type: "text", text: "Plan this change." }],
        })

        if (msg.info.role !== "user") throw new Error("expected user message")

        const reminder = msg.parts.find(
          (part) => part.type === "text" && part.synthetic && part.text.includes("Plan mode is active."),
        )
        expect(reminder?.type).toBe("text")
        if (reminder?.type !== "text") throw new Error("expected reminder text")
        expect(reminder.text).toContain(".opencorvus")
        expect(reminder.text).toContain("question")
        expect(reminder.text).toContain("plan_exit")
        expect(reminder.text).toContain("todowrite")
        expect(reminder.text).toContain("planner")
      },
    })
  }, 20000)

  test("injects a build reminder after the last plan-mode turn", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await Bun.write(Session.plan(session), "# plan\n")
        const seed: MessageV2.User = {
          id: "msg_seed",
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() - 1000 },
          agent: "plan",
          model: { providerID: "openai", modelID: "gpt-5.2" },
        }
        await Session.updateMessage(seed)
        await Session.updatePart({
          id: "prt_seed",
          messageID: seed.id,
          sessionID: session.id,
          type: "text",
          text: "planning",
        } satisfies MessageV2.TextPart)

        const msg = await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          model: { providerID: "openai", modelID: "gpt-5.2" },
          noReply: true,
          parts: [{ type: "text", text: "Start implementing." }],
        })

        if (msg.info.role !== "user") throw new Error("expected user message")

        const reminder = msg.parts.find(
          (part) => part.type === "text" && part.synthetic && part.text.includes("Plan mode has ended."),
        )
        expect(reminder?.type).toBe("text")
        if (reminder?.type !== "text") throw new Error("expected reminder text")
        expect(reminder.text).toContain(".opencorvus")
        expect(reminder.text).toContain("execution source of truth")
      },
    })
  }, 20000)
})
