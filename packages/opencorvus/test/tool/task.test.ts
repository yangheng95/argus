import { expect, test } from "bun:test"
import { sessionKindForSubagent } from "../../src/tool/task"

test("task tool creates explore subagents in the explore session lane", () => {
  expect(sessionKindForSubagent("explore")).toBe("explore")
  expect(sessionKindForSubagent("general")).toBe("assistant")
})
