import { afterEach, describe, expect, mock, test } from "bun:test"
import { readFileSync } from "fs"
import { join } from "path"

import { configure } from "../src/services/api"
import { setBoardStore } from "../src/store/board"
;(globalThis as typeof globalThis & { __OPENCORVUS_OVERLAY_VERSION__?: string }).__OPENCORVUS_OVERLAY_VERSION__ = "test"
const { cancelAgentSession, replyToAgentSession, sendTaskOperatorMessage } = await import("../src/services/task")

const originalFetch = globalThis.fetch
const root = join(import.meta.dir, "..")
const TASK_DIRECTORY = "D:/overlay/task-project"

afterEach(() => {
  globalThis.fetch = originalFetch
  configure({ serverUrl: "http://127.0.0.1:41111", directory: "" })
  setBoardStore("board", null)
})

describe("agent session controls", () => {
  test("replyToAgentSession posts scoped human input to the child session route", async () => {
    configure({ serverUrl: "http://overlay.test", directory: "" })
    const calls: Array<{ url: string; init?: RequestInit }> = []
    setBoardStore("board", { task: { id: "tsk_1", directory: TASK_DIRECTORY } })
    globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return new Response(JSON.stringify({ ok: true }), {
        status: 202,
        headers: { "content-type": "application/json" },
      })
    }) as typeof fetch

    await replyToAgentSession("tsk_1", "ses_child/1", "  keep this local  ")

    expect(calls.length).toBe(1)
    expect(calls[0].url).toBe(
      "http://overlay.test/task/tsk_1/session/ses_child%2F1/reply?directory=D%3A%2Foverlay%2Ftask-project",
    )
    expect(calls[0].init?.method).toBe("POST")
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ message: "keep this local" })
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

  test("sendTaskOperatorMessage posts visible build guidance to the task message route", async () => {
    configure({ serverUrl: "http://overlay.test", directory: "" })
    const calls: Array<{ url: string; init?: RequestInit }> = []
    setBoardStore("board", { task: { id: "tsk_1", directory: TASK_DIRECTORY } })
    globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return new Response(JSON.stringify({ kind: "note", message: "ok", should_resume: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }) as typeof fetch

    await sendTaskOperatorMessage("tsk_1", "  Build session steering from overlay.\n\nuse hchart  ", {
      source: "overlay_build_steer",
      target: {
        kind: "build_session",
        sessionID: "ses_build_1",
        goalID: "goal_1",
      },
    })

    expect(calls.length).toBe(1)
    expect(calls[0].url).toBe("http://overlay.test/task/tsk_1/message?directory=D%3A%2Foverlay%2Ftask-project")
    expect(calls[0].init?.method).toBe("POST")
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      text: "Build session steering from overlay.\n\nuse hchart",
      source: "overlay_build_steer",
      target: {
        kind: "build_session",
        sessionID: "ses_build_1",
        goalID: "goal_1",
      },
    })
  })

  test("agent steer input is constrained to two control rows", () => {
    const component = readFileSync(join(root, "src/components/AgentSessionReplyBox.tsx"), "utf8")
    const css = readFileSync(join(root, "src/styles/surfaces/card.css"), "utf8")

    expect(component).toContain("rows={2}")
    expect(component).not.toContain("rows={3}")
    expect(component).not.toContain("card__agent-reply-field")
    expect(css).not.toContain(".card__agent-reply-field")
    expect(css).toContain(".card__agent-reply {\n  position: relative;")
    expect(css).not.toContain("background: color-mix(in srgb, var(--surface-inset) 82%, transparent);")
    expect(css).toContain("resize: none;")
    expect(css).toContain("height: calc(58px * var(--ui-scale));")
    expect(css).toContain("max-height: calc(58px * var(--ui-scale));")
    expect(css).toContain("top: 50%;")
    expect(component).toContain('<Icon name="send" />')
    expect(css).not.toMatch(/\.card__agent-reply-send svg\s*\{[^}]*transform:\s*rotate\(180deg\)/)
    expect(css).not.toContain("min-height: calc(104px * var(--ui-scale));")
  })

  test("build cards route steer text through task operator guidance", () => {
    const card = readFileSync(join(root, "src/components/Card.tsx"), "utf8")
    const bubble = readFileSync(join(root, "src/components/ChatBubble.tsx"), "utf8")

    for (const source of [card, bubble]) {
      expect(source).toContain("sendTaskOperatorMessage")
      expect(source).toContain("normalizeAgentRole(")
      expect(source).toContain('"build" ? "task" : "session"')
      expect(source).toContain("Build session steering from overlay.")
      expect(source).toContain("overlay_build_steer")
      expect(source).toContain('kind: "build_session"')
      expect(source).toContain("sessionID")
      expect(source).toContain("goalID")
      expect(source).toContain("replyToAgentSession(taskID, sessionID, message)")
    }
  })
})
