import { expect, test } from "bun:test"
import fs from "node:fs/promises"

test("internal orchestrator wakes carry an explicit wake provenance marker", async () => {
  const source = await fs.readFile("packages/opencorvus/src/orchestrator/agent.ts", "utf8")

  expect(source).toContain("## Wake Provenance")
  expect(source).toContain("这是一条 wake 消息，不是用户发送的新消息。")
  expect(source).toContain("This is a wake message, not a user-authored message.")
  expect(source).toContain("Do not claim the user said, asked, sent, or implied anything")
})
