import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const repoRoot = path.resolve(import.meta.dir, "../..")

function source(relativePath: string) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8")
}

test("browser preview sidecars own navigation by browser inactivity", () => {
  const evidenceRunner = source("src/browser-preview/evidence-runner.ts")
  const live = source("src/browser-preview/live.ts")
  const localModule = source("src/browser-preview/local-module-source-binding.ts")
  const scrollSlice = source("src/browser-preview/scroll-slice-comparison.ts")

  expect(evidenceRunner).toContain("withBrowserInactivity")
  expect(evidenceRunner).toContain('() => page.goto(input.url, { waitUntil: "load", timeout: 0 })')
  expect(evidenceRunner).toContain('() => page.goto(targetUrl, { waitUntil: "load", timeout: 0 })')
  expect(evidenceRunner).toContain("navigationTimeoutMs: RUNTIME_CAPTURE_DEFAULTS.wait_timeout_ms")
  expect(evidenceRunner).toContain('on("requestfailed", (payload) => {')
  expect(evidenceRunner).toContain('fail(browserActivityLabel("requestfailed", payload))')
  expect(evidenceRunner).toContain('on("pageerror", (payload) => fail(browserActivityLabel("pageerror", payload)))')
  expect(evidenceRunner).toContain("recorded.failed_requests.length === 0")
  expect(evidenceRunner).not.toContain('on("requestfailed", (payload) => reset(browserActivityLabel("requestfailed", payload)))')
  expect(evidenceRunner).not.toContain('on("pageerror", (payload) => reset(browserActivityLabel("pageerror", payload)))')
  expect(evidenceRunner).not.toContain('page.goto(input.url, { waitUntil: "load", timeout: input.navigationTimeoutMs })')
  expect(evidenceRunner).not.toContain('page.goto(routeUrl(input.url, route), { waitUntil: "load", timeout: 30000 })')

  expect(live).toContain("withBrowserInactivity")
  expect(live).toContain('() => page.goto(command.url, { waitUntil: "load", timeout: 0 })')
  expect(live).toContain("browser failure before live capture")
  expect(live).toContain('on("requestfailed", (payload) => fail(browserActivityLabel("requestfailed", payload)))')
  expect(live).toContain('on("pageerror", (payload) => fail(browserActivityLabel("pageerror", payload)))')
  expect(live).not.toContain('page.goto(command.url, { waitUntil: "load", timeout: command.navigationTimeoutMs })')

  expect(localModule).toContain("withBrowserInactivity")
  expect(localModule).toContain('() => page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 0 })')
  expect(localModule).toContain('() => page.waitForLoadState("networkidle", { timeout: 0 })')
  expect(localModule).toContain("installBrowserFailureTracker")
  expect(localModule).toContain("isBrowserInactivityError")
  expect(localModule).toContain('fail(browserActivityLabel("requestfailed", payload))')
  expect(localModule).toContain('on("pageerror", (payload) => fail(browserActivityLabel("pageerror", payload)))')
  expect(localModule).not.toMatch(/waitForLoadState\("networkidle"[\s\S]{0,160}\)\.catch\(\(\) => undefined\)/)
  expect(localModule).not.toContain('on("requestfailed", (payload) => reset(browserActivityLabel("requestfailed", payload)))')
  expect(localModule).not.toContain('page.goto(routeUrl(input.url, input.route), { waitUntil: "networkidle", timeout: 30000 })')

  expect(scrollSlice).toContain("withBrowserInactivity")
  expect(scrollSlice).toContain('() => page.goto(routeUrl, { waitUntil: "domcontentloaded", timeout: 0 })')
  expect(scrollSlice).toContain('() => page.waitForLoadState("networkidle", { timeout: 0 })')
  expect(scrollSlice).toContain("installBrowserFailureTracker")
  expect(scrollSlice).toContain("isBrowserInactivityError")
  expect(scrollSlice).toContain('fail(browserActivityLabel("requestfailed", payload))')
  expect(scrollSlice).toContain('on("pageerror", (payload) => fail(browserActivityLabel("pageerror", payload)))')
  expect(scrollSlice).not.toMatch(/waitForLoadState\("networkidle"[\s\S]{0,160}\)\.catch\(\(\) => undefined\)/)
  expect(scrollSlice).not.toContain('on("requestfailed", (payload) => reset(browserActivityLabel("requestfailed", payload)))')
  expect(scrollSlice).not.toContain('page.goto(routeUrl, { waitUntil: "domcontentloaded", timeout: ${SCROLL_SLICE_ROUTE_NAVIGATION_TIMEOUT_MS} })')
})
