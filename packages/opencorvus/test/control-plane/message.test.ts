import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { ControlMessage } from "../../src/control"
import { Instance } from "../../src/project/instance"
import { SessionPrompt } from "../../src/session/prompt"
import { Message } from "../../src/session/message"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { installControlModel } from "./mock-control-model"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("control.message", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
  })

  test("runs through the core agent, panel tool, and structured output", async () => {
    await using tmp = await tmpdir({ git: true })
    installControlModel()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await ControlMessage.handle({
          surface: "panel",
          text: "switch executor to codex",
          executor: "codex",
        })
        expect(result.kind).toBe("panel_response")
        expect(result.local_action?.type).toBe("set_executor")
        if (result.local_action?.type === "set_executor") {
          expect(result.local_action.executor).toBe("codex")
        }
      },
    })
  })

  test("uses the control model to drive set_executor through the panel tool", async () => {
    await using tmp = await tmpdir({ git: true })
    installControlModel()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await ControlMessage.handle({
          surface: "panel",
          text: "Use executor codex for desktop panel actions and new tasks.",
          executor: "codex",
          metadata: {
            executor: "codex",
            ui_context: "engine_bar",
          },
        })

        expect(result.kind).toBe("panel_response")
        expect(result.local_action?.type).toBe("set_executor")
        if (result.local_action?.type === "set_executor") {
          expect(result.local_action.executor).toBe("codex")
        }
      },
    })
  })

  test("creates a session through the real control pipeline", async () => {
    await using tmp = await tmpdir({ git: true })
    installControlModel()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await ControlMessage.handle({
          surface: "panel",
          text: "Create a new session.",
          metadata: {
            ui_context: "session_manager",
          },
        })

        expect(result.kind).toBe("panel_response")
        expect(result.message).toContain("Session created:")
        expect(result.session_id).toBeDefined()
      },
    })
  })

  test("surfaces assistant provider errors when no text parts are returned", async () => {
    await using tmp = await tmpdir({ git: true })
    installControlModel()

    spyOn(SessionPrompt, "prompt").mockResolvedValue({
      info: Message.Assistant.parse({
        id: "msg_error",
        sessionID: "ses_mock",
        role: "assistant",
        time: {
          created: Date.now(),
          completed: Date.now(),
        },
        error: {
          name: "APIError",
          data: {
            message: "invalid access token or token expired",
            statusCode: 401,
            isRetryable: false,
          },
        },
        parentID: "msg_parent",
        modelID: "kimi-k2.5",
        providerID: "alibaba-coding-plan",
        mode: "build",
        agent: "build",
        path: {
          cwd: tmp.path,
          root: tmp.path,
        },
        cost: 0,
        tokens: {
          input: 0,
          output: 0,
          reasoning: 0,
          cache: {
            read: 0,
            write: 0,
          },
        },
      }),
      parts: [],
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await ControlMessage.handle({
          surface: "panel",
          text: "ping",
        })

        expect(result.kind).toBe("panel_response")
        expect(result.message).toContain("Provider error (alibaba-coding-plan/kimi-k2.5, status 401)")
        expect(result.message).toContain("invalid access token or token expired")
      },
    })
  })
})
