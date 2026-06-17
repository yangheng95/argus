import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const OVERLAY_ROOT = join(import.meta.dir, "..")

function readText(rel: string): string {
  return readFileSync(join(OVERLAY_ROOT, rel), "utf8")
}

test("executor popover CSS exposes only rendered group and model elements", () => {
  const source = readText("src/components/ExecutorSelector.tsx")
  const composerCss = readText("src/styles/surfaces/composer.css")

  expect(source).toContain('class="executor-popover-group-name"')
  expect(source).toContain('class="executor-popover-model-name"')
  expect(source).not.toContain("executor-popover-group-status")
  expect(source).not.toContain("executor-popover-model-badge")
  expect(composerCss).not.toContain(".executor-popover-group-status")
  expect(composerCss).not.toContain(".executor-popover-model-badge")
})
