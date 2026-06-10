import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const OVERLAY_ROOT = join(import.meta.dir, "..")

function readText(rel: string): string {
  return readFileSync(join(OVERLAY_ROOT, rel), "utf8")
}

describe("retired dialog dead code is removed from overlay runtime", () => {
  const domRefs = readText("src/dom.ts")
  const indexHtml = readText("src/index.html")
  const diffSurface = readText("src/styles/surfaces/diff.css")
  const dialogSurface = readText("src/styles/surfaces/dialog.css")
  const diffPreview = readText("src/components/DiffPreviewPanel.tsx")

  test("dom.ts no longer caches unused app/config/goal/diff dialog refs", () => {
    for (const token of [
      "configDialog:",
      "btnCloseConfigDialog:",
      "goalDialog:",
      "goalForm:",
      "goalDialogTitle:",
      "goalId:",
      "goalDescription:",
      "goalCriteria:",
      "btnCancelGoal:",
      "diffDialog:",
      "diffDialogTitle:",
      "diffDialogMeta:",
      "diffDialogBody:",
      "btnCloseDiff:",
      "appDialog:",
      "appDialogTitle:",
      "appDialogBody:",
      "appDialogInputField:",
      "appDialogInputLabel:",
      "appDialogInput:",
      "appDialogSelectField:",
      "appDialogSelectLabel:",
      "appDialogSelect:",
      "btnAppDialogCancel:",
      "btnAppDialogOk:",
      "logLevelFilter:",
      "HTMLSelectElement",
    ]) {
      expect(domRefs).not.toContain(token)
    }
  })

  test("index.html no longer ships the retired static diff dialog shell", () => {
    expect(indexHtml).not.toContain('id="diffDialog"')
    expect(indexHtml).not.toContain('id="diffDialogTitle"')
    expect(indexHtml).not.toContain('id="diffDialogMeta"')
    expect(indexHtml).not.toContain('id="diffDialogBody"')
    expect(indexHtml).not.toContain('id="btnCloseDiff"')
  })

  test("diff/dialog surfaces keep live diff chrome but drop the retired dialog-only selectors", () => {
    expect(diffSurface).toContain(".diff-dialog-stat")
    expect(diffPreview).toContain('class="diff-dialog-stat"')

    expect(diffSurface).not.toContain(".diff-dialog-head")
    expect(diffSurface).not.toContain(".diff-dialog-meta")
    expect(diffSurface).not.toContain(".diff-preview {")
    expect(dialogSurface).not.toContain(".diff-dialog-form")
  })
})
