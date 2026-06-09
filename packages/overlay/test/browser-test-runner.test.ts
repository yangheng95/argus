import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "..")

function readText(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8")
}

test("overlay browser tests have a Node-owned Playwright runner", () => {
  const pkg = JSON.parse(readText("package.json")) as { scripts: Record<string, string> }
  const runner = readText("test/browser-runner.mjs")
  const smoke = readText("test/browser/node-playwright-smoke.test.mjs")

  expect(pkg).toMatchObject({ type: "module" })
  expect(pkg.scripts["test:browser"]).toBe("node test/browser-runner.mjs")
  expect(runner).toContain("process.execPath")
  expect(runner).toContain('"--test"')
  expect(runner).toContain(".test.ts")
  expect(runner).toContain("OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER")
  expect(runner).not.toContain("--experimental-transform-types")
  expect(runner).not.toContain("bun test")
  expect(runner).not.toContain("bunx playwright")
  expect(runner).not.toContain("npx playwright")

  expect(smoke).toContain('import test from "node:test"')
  expect(smoke).toContain('require("playwright")')
  expect(smoke).toContain('typeof globalThis.Bun, "undefined"')
  expect(smoke).toContain("chromium.launch")

  const migrated = readText("test/browser/icon-affordance-computed.test.ts")
  expect(migrated).toContain('import test from "node:test"')
  expect(migrated).toContain('from "../launch.ts"')
  expect(migrated).toContain('typeof globalThis.Bun, "undefined"')

  const hoverGeometry = readText("test/browser/hover-action-geometry.test.ts")
  expect(hoverGeometry).toContain('import test from "node:test"')
  expect(hoverGeometry).toContain('from "../launch.ts"')
  expect(hoverGeometry).toContain('typeof globalThis.Bun, "undefined"')

  const longTranscript = readText("test/browser/long-transcript-scroll.test.ts")
  expect(longTranscript).toContain('import test from "node:test"')
  expect(longTranscript).toContain('from "../launch.ts"')
  expect(longTranscript).toContain('typeof globalThis.Bun, "undefined"')
})
