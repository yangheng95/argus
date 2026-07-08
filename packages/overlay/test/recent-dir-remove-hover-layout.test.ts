import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const CONVERSATION_CSS = readFileSync(
  path.join(import.meta.dir, "..", "src", "styles", "surfaces", "conversation.css"),
  "utf8",
)
const TASK_DIR_BAR = readFileSync(path.join(import.meta.dir, "..", "src", "components", "TaskDirBar.tsx"), "utf8")

describe("recent directory popup removal", () => {
  test("recent directory popup implementation and styles stay deleted", () => {
    for (const token of [
      "recent-dir-panel",
      "recent-dir-row",
      "recent-dir-item",
      "recent-dir-edit-submit",
      "recent-dir-remove",
      "recent-dir-current-path",
    ]) {
      expect(TASK_DIR_BAR).not.toContain(token)
      expect(CONVERSATION_CSS).not.toContain(token)
    }

    expect(TASK_DIR_BAR).not.toContain("ProjectDirectoryControl")
    expect(TASK_DIR_BAR).not.toContain('data-ui="cwd-path-input"')
    expect(TASK_DIR_BAR).not.toContain("loadRecentDirectories")
    expect(TASK_DIR_BAR).not.toContain("removeRecentDirectory")
  })
})
