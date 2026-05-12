import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const CHAT_BUBBLE_CSS = readFileSync(
  join(import.meta.dir, "..", "src", "styles", "surfaces", "chat-bubble.css"),
  "utf8",
)

test("chat-bubble animations stay compositor-only and disable under reduced motion", () => {
  expect(CHAT_BUBBLE_CSS).toContain("@keyframes chat-bubble-enter")
  expect(CHAT_BUBBLE_CSS).toContain("@keyframes chat-bubble-avatar-enter")
  expect(CHAT_BUBBLE_CSS).toContain("@keyframes chat-bubble-running-halo")
  expect(CHAT_BUBBLE_CSS).toContain("@keyframes chat-bubble-body-enter")
  expect(CHAT_BUBBLE_CSS).toContain(".chat-bubble:hover")
  expect(CHAT_BUBBLE_CSS).not.toContain("transform: translateY(calc(-1px * var(--ui-scale)))")
  expect(CHAT_BUBBLE_CSS).toContain("box-shadow: none;")
  expect(CHAT_BUBBLE_CSS).not.toContain("backdrop-filter")
  expect(CHAT_BUBBLE_CSS).toContain("@media (prefers-reduced-motion: reduce)")
  expect(CHAT_BUBBLE_CSS).toContain("animation: none;")
  expect(CHAT_BUBBLE_CSS).toContain("transition: none;")
  expect(CHAT_BUBBLE_CSS).not.toContain("!important")
})
