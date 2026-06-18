import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const CONVERSATION_TSX = readFileSync(join(import.meta.dir, "../src/components/Conversation.tsx"), "utf8")

test("Conversation empty state never derives a task context from the first task row", () => {
  expect(CONVERSATION_TSX).toContain("const taskID = currentTaskID()")
  expect(CONVERSATION_TSX).toContain("return tasks.find((item: any) => item?.task?.id === taskID || item?.id === taskID) || null")
  expect(CONVERSATION_TSX).toContain("return null")
  expect(CONVERSATION_TSX).not.toContain("return tasks[0] || null")
})

test("Conversation empty states use the Icon primitive", () => {
  expect(CONVERSATION_TSX).toContain('import { Icon } from "./Icon"')
  expect(CONVERSATION_TSX).toContain('<Icon name="file-document" class="chat-empty-icon" size={40} />')
  expect(CONVERSATION_TSX).toContain('<Icon name="message" class="chat-empty-icon" size={40} />')
  expect(CONVERSATION_TSX).not.toMatch(/<svg\b/i)
  expect(CONVERSATION_TSX).not.toContain('viewBox="0 0 40 40"')
})
