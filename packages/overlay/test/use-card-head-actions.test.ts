import { expect, mock, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createRoot } from "solid-js"

import type { CardNode } from "../src/store/card-tree"

const showAppDialog = mock(async () => ({ confirmed: true, value: "view" }))
const notifyError = mock(() => {})

mock.module("../src/services/app-dialog", () => ({
  showAppDialog,
}))
mock.module("../src/services/notify", () => ({
  formatErrorDetails: (error: unknown) => String(error),
  notifyError,
}))

const { setLocaleData } = await import("../src/utils/i18n")
const { useCardHeadActions } = await import("../src/hooks/use-card-head-actions")

setLocaleData("en-US", JSON.parse(readFileSync(join(import.meta.dir, "../src/i18n/en-US.json"), "utf8")))

function node(partial: Partial<CardNode> = {}): CardNode {
  return {
    id: "architect:session:ses_test",
    kind: "agent",
    stage: "architect",
    status: "running",
    title: "Architect",
    parts: [{ type: "text", text: "bubble body" }],
    childIDs: [],
    time: 100,
    ...partial,
  } as CardNode
}

function stopEvent() {
  return { stopPropagation: mock(() => {}) } as unknown as Event
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

test("copy writes transcript text and clears copied state after 1200ms", async () => {
  const writes: string[] = []
  Object.defineProperty(globalThis.navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (value: string) => {
        writes.push(value)
      },
    },
  })

  await new Promise<void>((resolve, reject) => {
    createRoot((dispose) => {
      const actions = useCardHeadActions({ node: () => node() })
      const event = stopEvent()
      actions.onCopy(event)
      void (async () => {
        try {
          await wait(0)
          expect(event.stopPropagation).toHaveBeenCalled()
          expect(writes).toEqual(["bubble body"])
          expect(actions.state.copied()).toBe(true)
          await wait(1250)
          expect(actions.state.copied()).toBe(false)
          dispose()
          resolve()
        } catch (error) {
          dispose()
          reject(error)
        }
      })()
    })
  })
})

test("cancel uses the injected sessionID and clears pending state after 800ms", async () => {
  const calls: string[] = []

  await new Promise<void>((resolve, reject) => {
    createRoot((dispose) => {
      const actions = useCardHeadActions({
        node: () => node(),
        agentSessionID: () => "ses_child",
        onAgentCancel: async (sessionID) => {
          calls.push(sessionID)
        },
      })
      const event = stopEvent()
      expect(actions.caps.canCancel()).toBe(true)
      actions.onAgentCancel(event)
      void (async () => {
        try {
          await wait(0)
          expect(event.stopPropagation).toHaveBeenCalled()
          expect(calls).toEqual(["ses_child"])
          expect(actions.state.cancelling()).toBe(true)
          await wait(850)
          expect(actions.state.cancelling()).toBe(false)
          dispose()
          resolve()
        } catch (error) {
          dispose()
          reject(error)
        }
      })()
    })
  })
})

test("rewind remains renderable but disabled and does not submit", async () => {
  const submitted = mock(async () => {})

  await new Promise<void>((resolve, reject) => {
    createRoot((dispose) => {
      const actions = useCardHeadActions({
        node: () => node(),
        onRewind: submitted,
      })
      const event = stopEvent()
      expect(actions.caps.canRewind()).toBe(true)
      expect(actions.caps.rewindDisabled()).toBe(true)
      expect(actions.labels.rewindDisabled()).toBe("Rewind is temporarily disabled")
      actions.onRewind(event)
      void (async () => {
        try {
          await wait(0)
          expect(event.stopPropagation).toHaveBeenCalled()
          expect(showAppDialog).not.toHaveBeenCalled()
          expect(submitted).not.toHaveBeenCalled()
          expect(notifyError).not.toHaveBeenCalled()
          expect(actions.state.rewinding()).toBe(false)
          dispose()
          resolve()
        } catch (error) {
          dispose()
          reject(error)
        }
      })()
    })
  })
})

test("cards retain task-scoped rewind submitters without local prune state", () => {
  const card = readFileSync(join(import.meta.dir, "../src/components/Card.tsx"), "utf8")
  const bubble = readFileSync(join(import.meta.dir, "../src/components/ChatBubble.tsx"), "utf8")
  const cardTree = readFileSync(join(import.meta.dir, "../src/store/card-tree.ts"), "utf8")
  const rewindService = readFileSync(join(import.meta.dir, "../src/services/rewind.ts"), "utf8")

  expect(card).not.toContain("pruneCardsAfterCursor")
  expect(bubble).not.toContain("pruneCardsAfterCursor")
  expect(cardTree).not.toContain("clearPruneCursor")
  expect(card).toContain("submitTaskRewind")
  expect(bubble).toContain("submitTaskRewind")
  expect(card).toContain('from "../services/rewind"')
  expect(bubble).toContain('from "../services/rewind"')
  expect(card).not.toContain("rewind request failed")
  expect(bubble).not.toContain("rewind request failed")
  expect(rewindService).toContain("throw new RewindRequestError")
})
