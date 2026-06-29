import { afterEach, describe, expect, mock, test } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"

import { configure } from "../src/services/api"
import { setBoardStore } from "../src/store/board"

;(globalThis as typeof globalThis & { __OPENCORVUS_OVERLAY_VERSION__?: string }).__OPENCORVUS_OVERLAY_VERSION__ = "test"
const { cancelAgentSession, sendOperatorSteer, OperatorSteerInputError } = await import("../src/services/task")

const originalFetch = globalThis.fetch
const root = join(import.meta.dir, "..")
const TASK_DIRECTORY = "D:/overlay/task-project"

afterEach(() => {
  globalThis.fetch = originalFetch
  configure({ serverUrl: "http://127.0.0.1:41111", directory: "" })
  setBoardStore("board", null)
})

describe("agent session controls", () => {
  test("sendOperatorSteer posts scoped human guidance to the operator steer route", async () => {
    configure({ serverUrl: "http://overlay.test", directory: "" })
    const calls: Array<{ url: string; init?: RequestInit }> = []
    setBoardStore("board", { task: { id: "tsk_1", directory: TASK_DIRECTORY } })
    globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return new Response(
        JSON.stringify({
          task_id: "tsk_1",
          session_id: "ses_child/1",
          request_id: "art_operator_steer_1",
          wake_status: "queued",
        }),
        {
          status: 202,
          headers: { "content-type": "application/json" },
        },
      )
    }) as typeof fetch

    const result = await sendOperatorSteer("tsk_1", "ses_child/1", "  keep this local  ")

    expect(result).toEqual({
      task_id: "tsk_1",
      session_id: "ses_child/1",
      request_id: "art_operator_steer_1",
      wake_status: "queued",
    })
    expect(calls.length).toBe(1)
    expect(calls[0].url).toBe(
      "http://overlay.test/task/tsk_1/session/ses_child%2F1/operator-steer?directory=D%3A%2Foverlay%2Ftask-project",
    )
    expect(calls[0].init?.method).toBe("POST")
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ message: "keep this local" })
  })

  test("sendOperatorSteer rejects missing context instead of clearing the draft as a no-op", async () => {
    configure({ serverUrl: "http://overlay.test", directory: "" })
    const calls: Array<{ url: string; init?: RequestInit }> = []
    globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }) as typeof fetch

    await expect(sendOperatorSteer("", "ses_child", "keep draft")).rejects.toBeInstanceOf(OperatorSteerInputError)
    await expect(sendOperatorSteer("tsk_1", "", "keep draft")).rejects.toBeInstanceOf(OperatorSteerInputError)
    await expect(sendOperatorSteer("tsk_1", "ses_child", "   ")).rejects.toBeInstanceOf(OperatorSteerInputError)
    expect(calls).toHaveLength(0)
  })

  test("cancelAgentSession posts to the child session cancel route", async () => {
    configure({ serverUrl: "http://overlay.test", directory: "" })
    const calls: Array<{ url: string; init?: RequestInit }> = []
    setBoardStore("board", { task: { id: "tsk_1", directory: TASK_DIRECTORY } })
    globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }) as typeof fetch

    await cancelAgentSession("tsk_1", "ses_child")

    expect(calls.length).toBe(1)
    expect(calls[0].url).toBe(
      "http://overlay.test/task/tsk_1/session/ses_child/cancel?directory=D%3A%2Foverlay%2Ftask-project",
    )
    expect(calls[0].init?.method).toBe("POST")
  })

  test("agent steer input reuses textarea and button primitives while staying compact", () => {
    const component = readFileSync(join(root, "src/components/AgentSessionReplyBox.tsx"), "utf8")
    const css = readFileSync(join(root, "src/styles/surfaces/card.css"), "utf8")

    expect(component).toContain('import { AutoGrowTextarea } from "./primitives/AutoGrowTextarea"')
    expect(component).toContain('import { Button } from "./ui/Button"')
    expect(component).toContain("<AutoGrowTextarea")
    expect(component).toContain("<Button")
    expect(component).toContain("rows={2}")
    expect(component).toContain("maxLines={2}")
    expect(component).not.toMatch(/<textarea\b/)
    expect(component).not.toMatch(/<button\b/)
    expect(component).not.toContain("rows={3}")
    expect(component).not.toContain("card__agent-reply-field")
    expect(css).not.toContain(".card__agent-reply-field")
    expect(css).toContain(".card__agent-reply {\n  position: relative;")
    expect(css).not.toContain("background: color-mix(in srgb, var(--surface-inset) 82%, transparent);")
    expect(css).toContain("resize: none;")
    expect(css).toContain("height: calc(58px * var(--ui-scale));")
    expect(css).toContain("max-height: calc(58px * var(--ui-scale));")
    expect(css).toContain("overflow-y: auto;")
    expect(css).toContain('data-ui="agent-reply-send"')
    expect(css).toContain('data-ui="agent-reply-error-dismiss"')
    expect(css).toContain("top: 50%;")
    expect(component).toContain('<Icon name="send" />')
    expect(css).not.toMatch(/agent-reply-send[^}]*transform:\s*rotate\(180deg\)/)
    expect(css).not.toContain("min-height: calc(104px * var(--ui-scale));")
  })

  test("inline steer callers use only the operator steer service", () => {
    const card = readFileSync(join(root, "src/components/Card.tsx"), "utf8")
    const bubble = readFileSync(join(root, "src/components/ChatBubble.tsx"), "utf8")
    const taskService = readFileSync(join(root, "src/services/task.ts"), "utf8")

    for (const source of [card, bubble]) {
      expect(source).toContain("sendOperatorSteer")
      expect(source).not.toContain("sendTaskOperatorMessage")
      expect(source).not.toContain("replyToAgentSession")
      expect(source).not.toContain("directAgentReplyMode")
      expect(source).not.toContain("Build session steering from overlay.")
      expect(source).not.toContain("overlay_build_steer")
      expect(source).not.toContain('kind: "build_session"')
      expect(source).not.toContain('"build" ? "task" : "session"')
    }
    expect(card).toContain('throw new Error(t("card.agent_reply_missing_task"))')
    expect(bubble).toContain('throw new Error(t("card.agent_reply_missing_task"))')
    expect(bubble).toContain("function ChatBubbleAgentChildBody")
    expect(bubble).toContain("<AgentSessionReplyBox onSend={(message) => props.onAgentReply")
    expect(bubble).toContain("rootTaskSessionID={rootTaskSessionID()}")

    expect(taskService).toContain("sendOperatorSteer")
    expect(taskService).toContain("/operator-steer")
    expect(taskService).toContain("OperatorSteerInputError")
    expect(taskService).not.toContain("replyToAgentSession")
    expect(taskService).not.toContain("sendTaskOperatorMessage")
    expect(taskService).not.toContain('source: "overlay_build_steer"')
    expect(taskService).not.toContain('taskPath(taskID, "/message")')
  })
})
