import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { ControlMessage } from "../../src/control"
import { Instance } from "../../src/project/instance"
import { SessionPrompt } from "../../src/session/prompt"
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

  test("returns a task-first response when panel users ask for session management", async () => {
    await using tmp = await tmpdir({ git: true })
    installControlModel()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await ControlMessage.handle({
          surface: "panel",
          text: "Create a new session.",
          metadata: {
            ui_context: "task_list",
          },
        })

        expect(result.kind).toBe("panel_response")
        expect(result.message).toContain("only exposes tasks")
        expect(result.session_id).toBeUndefined()
      },
    })
  })

  test("fails explicitly when the control model does not return structured output", async () => {
    await using tmp = await tmpdir({ git: true })
    installControlModel()
    spyOn(SessionPrompt, "prompt").mockResolvedValue({
      info: {
        role: "assistant",
        error: {
          message: "invalid create_task args: missing request; checks.build must be string[] or false",
        },
      },
      parts: [
        {
          type: "text",
          text: "Let me correct the parameters and try again.",
        },
      ],
    } as any)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await ControlMessage.handle({
          surface: "panel",
          text: "Create a task for this PRD.",
        })

        expect(result.kind).toBe("panel_response")
        expect(result.message).toContain("Control message processing failed")
        expect(result.message).toContain("missing request")
        expect(result.message).not.toContain("Let me correct the parameters")
      },
    })
  })
})
