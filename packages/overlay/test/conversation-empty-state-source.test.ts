import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const CONVERSATION_TSX = readFileSync(join(import.meta.dir, "../src/components/Conversation.tsx"), "utf8")

test("Conversation empty state never derives a task context from the first task row", () => {
  expect(CONVERSATION_TSX).toContain("const taskID = currentTaskID()")
  expect(CONVERSATION_TSX).toContain(
    "return tasks.find((item: any) => item?.task?.id === taskID || item?.id === taskID) || null",
  )
  expect(CONVERSATION_TSX).toContain("return null")
  expect(CONVERSATION_TSX).not.toContain("return tasks[0] || null")
})
