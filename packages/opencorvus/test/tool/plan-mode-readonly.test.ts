import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message"
import { Identifier } from "../../src/id/id"
import { PermissionNext } from "../../src/permission/next"
import { TaskTool } from "../../src/tool/task"
import { SessionPrompt } from "../../src/session/prompt"
import { resetDatabase } from "../fixture/db"

describe("plan mode read-only enforcement", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
  })

  test("task sub-sessions inherit read-only restrictions in plan mode", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ title: "parent" })
        const user: MessageV2.User = {
          id: Identifier.ascending("message"),
          sessionID: parent.id,
          role: "user",
          time: { created: Date.now() - 10 },
          agent: "plan",
          model: { providerID: "openai", modelID: "gpt-5.2" },
        }
        await Session.updateMessage(user)
        const assistant: MessageV2.Assistant = {
          id: Identifier.ascending("message"),
          sessionID: parent.id,
          role: "assistant",
          parentID: user.id,
          mode: "plan",
          agent: "plan",
          path: { cwd: tmp.path, root: tmp.path },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: "gpt-5.2",
          providerID: "openai",
          time: { created: Date.now() },
        }
        await Session.updateMessage(assistant)

        const captured: Array<{ sessionID: string; extra?: Record<string, any> }> = []
        spyOn(SessionPrompt, "prompt").mockImplementation(async (input) => {
          captured.push({ sessionID: input.sessionID, extra: input.extra })
          return {
            info: {
              id: Identifier.ascending("message"),
              sessionID: input.sessionID,
              role: "assistant",
              parentID: input.messageID ?? "msg_parent",
              mode: "explore",
              agent: "explore",
              path: { cwd: tmp.path, root: tmp.path },
              cost: 0,
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              modelID: "gpt-5.2",
              providerID: "openai",
              time: { created: Date.now(), completed: Date.now() },
              finish: "stop",
            } satisfies MessageV2.Assistant,
            parts: [
              {
                id: Identifier.ascending("part"),
                sessionID: input.sessionID,
                messageID: input.messageID ?? Identifier.ascending("message"),
                type: "text",
                text: "exploration only",
              } satisfies MessageV2.TextPart,
            ],
          }
        })

        const task = await TaskTool.init({ agent: await import("../../src/agent/agent").then((m) => m.Agent.get("plan")) as any })
        const result = await task.execute(
          {
            description: "Inspect auth",
            prompt: "Inspect auth flow only.",
            subagent_type: "explore",
          },
          {
            sessionID: parent.id,
            messageID: assistant.id,
            agent: "plan",
            abort: new AbortController().signal,
            extra: { planMode: true },
            messages: [],
            metadata: async () => {},
            ask: async () => {},
          },
        )

        expect(result.metadata.sessionId).toBeTruthy()
        const child = await Session.get(result.metadata.sessionId)
        expect(PermissionNext.evaluate("edit", "src/auth.ts", child.permission ?? []).action).toBe("deny")
        expect(PermissionNext.evaluate("bash", "*", child.permission ?? []).action).toBe("deny")
        expect(PermissionNext.evaluate("apply_patch", "*", child.permission ?? []).action).toBe("deny")
        expect(PermissionNext.evaluate("schedule", "*", child.permission ?? []).action).toBe("deny")
        expect(captured[0]?.extra?.planMode).toBe(true)
      },
    })
  })
})
