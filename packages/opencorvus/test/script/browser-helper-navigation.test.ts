import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dir, "../../../..")

function source(relativePath: string) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8")
}

describe("browser helper navigation contracts", () => {
  test("screenshot helpers use shared no-activity navigation and do not swallow navigation failures", () => {
    for (const file of [
      "packages/opencorvus/script/screenshot-overlay.ts",
      "packages/opencorvus/script/overlay-snap.ts",
      "packages/opencorvus/script/benchmark/capture-ainvest-reference.ts",
      "packages/opencorvus/script/verify-executor-selector.ts",
      "packages/overlay/script/screenshot.ts",
      "packages/overlay/script/snap-titlebar.ts",
      "packages/overlay/script/snap-settings.ts",
      "packages/overlay/script/snap-goal.ts",
    ]) {
      const text = source(file)
      expect(text).toContain("gotoWithBrowserInactivity")
      expect(text).not.toContain("page.goto(")
      expect(text).not.toContain("page.goto warning")
      expect(text).not.toContain("catch((e)")
    }
  })

  test("web docs screenshot QA fails on browser errors and uses inactivity navigation", () => {
    const text = source("packages/web/qa/screenshot-all.cjs")
    expect(text).toContain("withDocsBrowserInactivity")
    expect(text).toContain('page.goto(url, { waitUntil: "domcontentloaded", timeout: 0 })')
    expect(text).toContain('page.waitForLoadState("networkidle", { timeout: 0 })')
    expect(text).toContain("browser failure before screenshot")
    expect(text).toContain('on("requestfailed", (payload) => fail(docsActivityLabel("requestfailed", payload)))')
    expect(text).toContain('on("pageerror", (payload) => fail(docsActivityLabel("pageerror", payload)))')
    expect(text).not.toContain('page.goto(url, { waitUntil: "networkidle", timeout: 30000 })')
  })
})
