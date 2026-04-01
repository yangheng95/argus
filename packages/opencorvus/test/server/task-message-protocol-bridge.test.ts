import { expect, test } from "bun:test"
import { resolveRole } from "../../src/server/routes/task-message-protocol-bridge"

test("coding executor ids resolve to executor overlay role", () => {
  expect(resolveRole("opencode")).toBe("executor")
  expect(resolveRole("codex")).toBe("executor")
  expect(resolveRole("claude-code")).toBe("executor")
})
