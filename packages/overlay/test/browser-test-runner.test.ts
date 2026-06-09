import { expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "..")

function readText(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8")
}

function filesIn(rel: string, predicate: (name: string) => boolean): string[] {
  return readdirSync(path.join(ROOT, rel))
    .filter(predicate)
    .map((name) => path.posix.join(rel.replaceAll("\\", "/"), name))
    .sort()
}

test("overlay browser tests have a Node-owned Playwright runner", () => {
  const pkg = JSON.parse(readText("package.json")) as { scripts: Record<string, string> }
  const runner = readText("test/browser-runner.mjs")
  const smoke = readText("test/browser/node-playwright-smoke.test.mjs")
  const topLevelUnitTests = filesIn(
    "test",
    (name) => name.endsWith(".test.ts") && name !== "browser-test-runner.test.ts",
  )
  const browserTests = filesIn("test/browser", (name) => name.endsWith(".test.ts") || name.endsWith(".test.mjs"))

  expect(pkg).toMatchObject({ type: "module" })
  expect(pkg.scripts["test"]).toBe("bun run test:unit")
  expect(pkg.scripts["test:unit"]).toBe("bun test --timeout 120000 test/*.test.ts")
  expect(pkg.scripts["test:browser"]).toBe("node test/browser-runner.mjs")
  expect(pkg.scripts["test:unit"]).not.toContain("test/browser")
  expect(runner).toContain("process.execPath")
  expect(runner).toContain('"--test"')
  expect(runner).toContain("--test-concurrency=1")
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

  for (const file of topLevelUnitTests) {
    const source = readText(file)
    expect(source, `${file} must not launch overlay browser automation from bun test`).not.toContain("launchBrowser(")
    expect(source, `${file} must not launch Playwright from bun test`).not.toContain("chromium.launch")
    expect(source, `${file} must not require Playwright from bun test`).not.toContain('require("playwright")')
    expect(source, `${file} must not import Playwright from bun test`).not.toContain('from "playwright"')
    expect(source, `${file} must not import Playwright from bun test`).not.toContain("from 'playwright'")
  }

  for (const file of browserTests) {
    const source = readText(file)
    expect(source, `${file} must run under node:test`).toContain('import test from "node:test"')
    expect(source, `${file} must assert the Node runner marker`).toContain(
      "OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER",
    )
    expect(source, `${file} must assert Bun is absent`).toContain('typeof globalThis.Bun, "undefined"')
    if (file === "test/browser/node-playwright-smoke.test.mjs") continue
    expect(source, `${file} must use the shared Node sidecar launcher`).toContain('from "../launch.ts"')
    expect(source, `${file} must not launch Playwright directly`).not.toContain("chromium.launch")
    expect(source, `${file} must not require Playwright directly`).not.toContain('require("playwright")')
    expect(source, `${file} must not import Playwright directly`).not.toContain('from "playwright"')
    expect(source, `${file} must not import Playwright directly`).not.toContain("from 'playwright'")
  }

  const dist = readText("test/overlay-dist.ts")
  expect(dist).toContain('from "node:child_process"')
  expect(dist).toContain("readFile(file)")
  expect(dist).not.toContain("Bun.spawn")
  expect(dist).not.toContain("Bun.file")
})
