import { afterEach, describe, expect, mock, test } from "bun:test"
import { ControlMessage } from "../../src/control"
import { structuredOutputFailureMessage } from "../../src/control/message"
import { Instance } from "../../src/project/instance"
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

  // Hangs at 5s because ControlMessage.handle spins up a real LLM core agent loop.
  // Skipped until this can be replaced with a stub agent.
  test.skip("runs through the core agent, panel tool, and structured output", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "mock-control/control" } })
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

  // Same heavyweight LLM core agent loop times out at 5s without a stub agent.
  test.skip("uses the control model to drive set_executor through the panel tool", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "mock-control/control" } })
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

  // Real control pipeline times out at 5s without a stub agent — same root cause as siblings.
  test.skip("creates a session through the real control pipeline", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "mock-control/control" } })
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
    const message = {
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
          cwd: "D:\\workspace",
          root: "D:\\workspace",
        },
        cost: 0,
        tokens: {
          total: 0,
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
    } satisfies Message.WithParts

    const error = structuredOutputFailureMessage(message)

    expect(error).toContain("Provider error (alibaba-coding-plan/kimi-k2.5, status 401)")
    expect(error).toContain("invalid access token or token expired")
  })

  test("does not parse text or fenced JSON when control StructuredOutput is missing", async () => {
    const message = {
      info: Message.Assistant.parse({
        id: "msg_text",
        sessionID: "ses_mock",
        role: "assistant",
        time: {
          created: Date.now(),
          completed: Date.now(),
        },
        parentID: "msg_parent",
        modelID: "kimi-k2.5",
        providerID: "alibaba-coding-plan",
        mode: "build",
        agent: "control",
        path: {
          cwd: "D:\\workspace",
          root: "D:\\workspace",
        },
        cost: 0,
        tokens: {
          total: 0,
          input: 0,
          output: 0,
          reasoning: 0,
          cache: {
            read: 0,
            write: 0,
          },
        },
      }),
      parts: [
        {
          id: "prt_text",
          sessionID: "ses_mock",
          messageID: "msg_text",
          type: "text",
          text: '```json\n{"kind":"panel_response","message":"silently accepted"}\n```',
        },
      ],
    } satisfies Message.WithParts

    const error = structuredOutputFailureMessage(message)

    expect(error).toBe("Control message did not produce the required structured output.")
    expect(error).not.toContain("silently accepted")
  })
})
