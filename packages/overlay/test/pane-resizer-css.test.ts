import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "..")

function readSrc(rel: string): string {
  return readFileSync(join(ROOT, "src", rel), "utf8")
}

test("right pane resizer CSS stays retired with the null right handle config", () => {
  const html = readSrc("index.html")
  const pane = readSrc("services/pane.ts")
  const workspaceCss = readSrc("styles/surfaces/workspace.css")

  expect(html).toContain('id="leftPaneResizer"')
  expect(html).not.toContain('id="rightPaneResizer"')
  expect(pane).toContain("rightHandleId: null")
  expect(pane).toContain("rightControls: null")
  expect(workspaceCss).toContain(".pane-resizer-left")
  expect(workspaceCss).not.toContain(".pane-resizer-right")
})
