import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const MEMORY_PANEL_SOURCE = join(import.meta.dir, "..", "src", "components", "MemoryPanel.tsx")

describe("MemoryPanel inline detail lifecycle", () => {
  const source = readFileSync(MEMORY_PANEL_SOURCE, "utf8")

  test("memory detail expands inline instead of opening a dialog", () => {
    expect(source).not.toContain("MemoryDetailDialog")
    expect(source).not.toContain("<Dialog")
    expect(source).toContain("expandedFileId")
    expect(source).toContain("loadMemoryDetail")
    expect(source).toContain('class="memory-inline-detail"')
    expect(source).toContain('class="knowledge-item-meta-row"')
    expect(source).toContain('data-expanded={expanded() ? "true" : "false"}')
    expect(source).toContain("aria-expanded={expanded()}")
  })

  test("memory panel reads task identifier through a reactive accessor", () => {
    expect(source).toContain("taskID?: string | (() => string | undefined)")
    expect(source).toContain('const currentTaskID = () => (typeof props.taskID === "function" ? props.taskID() : props.taskID)')
    expect(source).toContain("const taskID = currentTaskID()")
    expect(source).toContain("taskID: currentTaskID() || undefined")
  })
})
