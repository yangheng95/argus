import { expect, test } from "bun:test"
import MISSION_CORE from "../src/prompt/core/mission-core.txt"

test("Mission prompt uses panel create/query surfaces instead of a generic task tool", () => {
  expect(MISSION_CORE).toContain("panel.create_task")
  expect(MISSION_CORE).toContain("panel query_task")
  expect(MISSION_CORE).toContain("Do not refer to or rely on a generic `task` tool from Mission.")
  expect(MISSION_CORE).not.toContain("through the `task` tool")
})
