import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const CHAT_BUBBLE = readFileSync(join(import.meta.dir, "../src/components/ChatBubble.tsx"), "utf8")
const MESSAGE_UTILS = readFileSync(join(import.meta.dir, "../src/utils/message.ts"), "utf8")
const CHAT_BUBBLE_CSS = readFileSync(join(import.meta.dir, "../src/styles/surfaces/chat-bubble.css"), "utf8")

test("chat bubbles expose normalized user and mission roles in DOM and labels", () => {
  expect(MESSAGE_UTILS).toContain('if (text === "user") return "user"')
  expect(MESSAGE_UTILS).toContain('if (text === "mission") return "mission"')
  expect(MESSAGE_UTILS).toContain('if (role === "user") return t("chat.role.user")')
  expect(MESSAGE_UTILS).toContain('if (role === "mission") return t("chat.role.mission")')
  expect(CHAT_BUBBLE).toContain("const normalizedRole = () => normalizeAgentRole")
  expect(CHAT_BUBBLE).toContain("data-role={normalizedRole()}")
})

test("chat bubble CSS gives user and mission roles separate visible treatments", () => {
  expect(CHAT_BUBBLE_CSS).toContain('.chat-bubble-row[data-role="user"] .chat-bubble-shell')
  expect(CHAT_BUBBLE_CSS).toContain('.chat-bubble-row[data-role="user"] .chat-bubble__title-row')
  expect(CHAT_BUBBLE_CSS).toContain('.chat-bubble-row[data-role="mission"] .chat-bubble')
  expect(CHAT_BUBBLE_CSS).toContain("border-left: calc(3px * var(--ui-scale)) solid var(--card-stage)")
  expect(CHAT_BUBBLE_CSS).toContain('.chat-bubble-row[data-role="mission"] .chat-avatar')
  expect(CHAT_BUBBLE_CSS).toContain('.chat-bubble-row[data-role="mission"] .chat-bubble__title')
})
