import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Bus } from "../../src/bus"
import { ControlMessage } from "../../src/control"
import { Instance } from "../../src/project/instance"
import { MessageV2 } from "../../src/session/message"
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

  test("handleStream only emits structured user-facing text", async () => {
    await using tmp = await tmpdir({ git: true })

    spyOn(SessionPrompt, "prompt").mockImplementation(async (input: any) => {
      const now = Date.now()
      const messageID = "msg_control"
      await Bus.publish(MessageV2.Event.Updated, {
        info: {
          id: messageID,
          sessionID: input.sessionID,
          role: "assistant",
          time: { created: now, completed: now },
          parentID: "msg_parent",
          modelID: "control",
          providerID: "mock-control",
          mode: "json_schema",
          agent: "control",
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
          structured: {
            kind: "panel_response",
            message: "任务已创建",
          },
        },
      })
      await Bus.publish(MessageV2.Event.PartDelta, {
        sessionID: input.sessionID,
        messageID,
        partID: "raw_assistant_text",
        field: "text",
        delta: "用户请求创建一个日记网页，我需要调用 panel 工具。",
      })
      await Bus.publish(MessageV2.Event.PartUpdated, {
        part: {
          id: "structured_part",
          sessionID: input.sessionID,
          messageID,
          type: "tool",
          callID: "call_structured",
          tool: "StructuredOutput",
          state: {
            status: "pending",
            input: {
              message: "任务已创建",
            },
            raw: "{\"message\":\"任务已创建\"}",
          },
        },
      })
      return {
        info: {
          role: "assistant",
          structured: {
            kind: "panel_response",
            message: "任务已创建",
          },
        },
        parts: [],
      } as any
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const events: Array<{ type: string; [key: string]: unknown }> = []
        const result = await ControlMessage.handleStream({
          surface: "panel",
          text: "创建一个日记网页",
        }, (event) => {
          events.push(event)
        })

        expect(result.message).toBe("任务已创建")
        expect(events.some((event) => event.type === "message_delta" && event.delta === "任务已创建")).toBe(true)
        expect(events.some((event) => String(event.delta || "").includes("日记网页"))).toBe(false)
      },
    })
  })

  test("handleStream emits reasoning deltas without leaking control raw text", async () => {
    await using tmp = await tmpdir({ git: true })

    spyOn(SessionPrompt, "prompt").mockImplementation(async (input: any) => {
      const now = Date.now()
      const messageID = "msg_control_reasoning"
      await Bus.publish(MessageV2.Event.Updated, {
        info: {
          id: messageID,
          sessionID: input.sessionID,
          role: "assistant",
          time: { created: now, completed: now },
          parentID: "msg_parent",
          modelID: "control",
          providerID: "mock-control",
          mode: "json_schema",
          agent: "control",
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
          structured: {
            kind: "panel_response",
            message: "任务已创建",
          },
        },
      })
      await Bus.publish(MessageV2.Event.PartUpdated, {
        part: {
          id: "reasoning_part",
          sessionID: input.sessionID,
          messageID,
          type: "reasoning",
          text: "",
          time: { start: now },
        },
      })
      await Bus.publish(MessageV2.Event.PartDelta, {
        sessionID: input.sessionID,
        messageID,
        partID: "reasoning_part",
        field: "text",
        delta: "先确认用户要求，再创建任务。",
      })
      await Bus.publish(MessageV2.Event.PartDelta, {
        sessionID: input.sessionID,
        messageID,
        partID: "raw_assistant_text",
        field: "text",
        delta: "这段控制平面原始文本不应直接透出。",
      })
      await Bus.publish(MessageV2.Event.PartUpdated, {
        part: {
          id: "structured_part",
          sessionID: input.sessionID,
          messageID,
          type: "tool",
          callID: "call_structured",
          tool: "StructuredOutput",
          state: {
            status: "pending",
            input: {
              message: "任务已创建",
            },
            raw: "{\"message\":\"任务已创建\"}",
          },
        },
      })
      return {
        info: {
          role: "assistant",
          structured: {
            kind: "panel_response",
            message: "任务已创建",
          },
        },
        parts: [],
      } as any
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const events: Array<{ type: string; [key: string]: unknown }> = []
        const result = await ControlMessage.handleStream({
          surface: "panel",
          text: "创建一个日记网页",
        }, (event) => {
          events.push(event)
        })

        expect(result.message).toBe("任务已创建")
        expect(events.some((event) => event.type === "reasoning_delta" && event.delta === "先确认用户要求，再创建任务。")).toBe(true)
        expect(events.some((event) => event.type === "message_delta" && event.delta === "任务已创建")).toBe(true)
        expect(events.some((event) => String(event.delta || "").includes("控制平面原始文本"))).toBe(false)
      },
    })
  })

  test("handleStream emits control progress before the structured result arrives", async () => {
    await using tmp = await tmpdir({ git: true })

    spyOn(SessionPrompt, "prompt").mockImplementation(async (input: any) => {
      const now = Date.now()
      const messageID = "msg_control_tool_progress"
      await Bus.publish(MessageV2.Event.Updated, {
        info: {
          id: messageID,
          sessionID: input.sessionID,
          role: "assistant",
          time: { created: now, completed: now },
          parentID: "msg_parent",
          modelID: "control",
          providerID: "mock-control",
          mode: "json_schema",
          agent: "control",
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
          structured: {
            kind: "panel_response",
            message: "任务已创建",
          },
        },
      })
      await Bus.publish(MessageV2.Event.PartUpdated, {
        part: {
          id: "tool_panel_create_task",
          sessionID: input.sessionID,
          messageID,
          type: "tool",
          callID: "call_panel_create_task",
          tool: "panel",
          state: {
            status: "running",
            input: {
              action: "create_task",
              request: "创建一个电商网站",
            },
            time: { start: now },
          },
        },
      })
      await Bus.publish(MessageV2.Event.PartUpdated, {
        part: {
          id: "structured_part",
          sessionID: input.sessionID,
          messageID,
          type: "tool",
          callID: "call_structured",
          tool: "StructuredOutput",
          state: {
            status: "pending",
            input: {
              message: "任务已创建",
            },
            raw: "{\"message\":\"任务已创建\"}",
          },
        },
      })
      return {
        info: {
          role: "assistant",
          structured: {
            kind: "panel_response",
            message: "任务已创建",
          },
        },
        parts: [],
      } as any
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const events: Array<{ type: string; [key: string]: unknown }> = []
        const result = await ControlMessage.handleStream({
          surface: "panel",
          text: "创建一个电商网站",
        }, (event) => {
          events.push(event)
        })

        expect(result.message).toBe("任务已创建")
        expect(events.some((event) => event.type === "reasoning_delta" && event.delta === "正在分析请求并规划下一步...")).toBe(true)
        expect(events.some((event) => event.type === "reasoning_delta" && event.delta === "正在创建任务并启动规划...")).toBe(true)
        expect(events.some((event) => String(event.delta || "").includes("电商网站"))).toBe(false)
      },
    })
  })
})
