import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"

const AUDIT_CALCULATOR = path.resolve(import.meta.dir, "../../script/benchmark/audit-calculator.ts")

describe("audit calculator benchmark verdict", () => {
  test("required checks cannot pass as warn or skip", async () => {
    const source = await fs.readFile(AUDIT_CALCULATOR, "utf8")

    expect(source).toContain('status: "pass" | "fail"')
    expect(source).not.toContain('"warn"')
    expect(source).not.toContain('"skip"')
    expect(source).not.toContain("WARN")
    expect(source).not.toContain("SKIP")
    expect(source).not.toContain("best-effort")
    expect(source).not.toContain("warned")
    expect(source).not.toContain("skipped")
  })

  test("visual-only and test uncertainty are blocking failures", async () => {
    const source = await fs.readFile(AUDIT_CALCULATOR, "utf8")

    expect(source).toContain("rendered live expression evidence found")
    expect(source).toContain("source references found but no rendered live expression evidence")
    expect(source).not.toContain("code refs found")
    expect(source).not.toContain("visual-only check pending")
    expect(source).toContain('record("TESTS", "unit tests", r.code === 0 ? "pass" : "fail"')
    expect(source).toContain('record("TESTS", "unit tests", "fail", "no test script in package.json")')
  })

  test("command runner uses inactivity timeout reset by stdout and stderr", async () => {
    const source = await fs.readFile(AUDIT_CALCULATOR, "utf8")

    expect(source).toContain("inactivityTimeoutMs")
    expect(source).toContain('resetInactivityTimer("stdout")')
    expect(source).toContain('resetInactivityTimer("stderr")')
    expect(source).toContain('resetInactivityTimer("spawn")')
    expect(source).toContain("inactive for ${inactivityTimeoutMs}ms")
    expect(source).toContain("terminateChildProcessTree(child, `${cmd} inactivity`)")
    expect(source).toContain("finish(-1)")
    expect(source).toContain('detached: process.platform !== "win32"')
    expect(source).not.toContain('child.kill("SIGKILL")')
    expect(source).not.toContain("timeoutMs?:")
    expect(source).not.toContain("opts.timeoutMs")
    expect(source).not.toContain("const t = setTimeout")
  })

  test("preview startup and browser collection fail on inactivity and network errors", async () => {
    const source = await fs.readFile(AUDIT_CALCULATOR, "utf8")

    expect(source).toContain("previewStartupInactivityTimeoutMs")
    expect(source).toContain("lastPreviewActivityAt")
    expect(source).toContain('markPreviewActivity("stdout")')
    expect(source).toContain('markPreviewActivity("stderr")')
    expect(source).toContain('markPreviewActivity("authoritative-probe")')
    expect(source).not.toContain('markPreviewActivity("probe")')
    expect(source).toContain("function fetchWithDeadline")
    expect(source).toContain("AbortController")
    expect(source).toContain("fetch(url, { signal: controller.signal })")
    expect(source).toContain("previewExit")
    expect(source).toContain("log.includes(`127.0.0.1:${port}`)")
    expect(source).not.toContain("const t0 = Date.now()")
    expect(source).toContain('page.on("response"')
    expect(source).toContain("if (status >= 400)")
    expect(source).toContain('page.on("requestfailed"')
    expect(source).toContain("request.failure()")
  })

  test("preview cleanup uses process-tree termination and awaits child close", async () => {
    const source = await fs.readFile(AUDIT_CALCULATOR, "utf8")

    expect(source).toContain("async function terminateChildProcessTree")
    expect(source).toContain('spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"]')
    expect(source).toContain("result.status !== 0 && !childHasExited(child)")
    expect(source).toContain("process tree did not exit after taskkill")
    expect(source).toContain('process.kill(-pid, "SIGTERM")')
    expect(source).toContain('process.kill(-pid, "SIGKILL")')
    expect(source).toContain('() => terminateChildProcessTree(preview, "preview cleanup")')
    expect(source).toContain("const cleanupErrors: string[] = []")
    expect(source).toContain('record(`CLEANUP-${label}`, `${label} cleanup`, "fail", message)')
    expect(source).not.toContain('preview?.kill("SIGTERM")')
    expect(source).not.toContain('preview?.kill("SIGKILL")')
  })

  test("theme verdicts use rendered toggle behavior instead of source regex evidence", async () => {
    const source = await fs.readFile(AUDIT_CALCULATOR, "utf8")

    expect(source).toContain("readThemeState")
    expect(source).toContain("themeControl")
    expect(source).toContain("localStorage")
    expect(source).toContain('record(\n    "R10-toggle"')
    expect(source).toContain('record(\n    "R10-dark-default"')
    expect(source).toContain('record(\n    "R10-storage"')
    expect(source).toContain('record(\n    "R10-reload"')
    expect(source).toContain("themeAfterReload")
    expect(source).toContain("themeAfterReload.signature === themeAfter.signature")
    expect(source).not.toContain('record("R10-toggle", "theme toggle exists", themeRefs.toggle')
    expect(source).not.toContain("themeRefs")
    expect(source).not.toContain("codeBundle),\n    darkClass")
  })

  test("history and pressed-state verdicts use rendered interaction evidence", async () => {
    const source = await fs.readFile(AUDIT_CALCULATOR, "utf8")

    expect(source).toContain("historyBeforeClick")
    expect(source).toContain("historyElements")
    expect(source).toContain("historyDisplayAfterClick")
    expect(source).toContain("historyAfterReload")
    expect(source).toContain("historyDisplayAfterReloadClick")
    expect(source).toContain('reloadWithBrowserInactivity(page, "networkidle", 30_000)')
    expect(source).toContain("pressedTarget")
    expect(source).toContain("page.mouse.down()")
    expect(source).toContain("pressedBefore !== pressedAfter")
    expect(source).not.toContain("history.*20|20.*history")
    expect(source).not.toContain("clearHistory: /clear")
    expect(source).not.toContain("clickToFill: /history")
    expect(source).not.toContain("localStorage.*history|history.*localStorage")
    expect(source).not.toContain("const pressedFeedback = /:active")
  })

  test("layout verdict requires exactly four keypad columns", async () => {
    const source = await fs.readFile(AUDIT_CALCULATOR, "utf8")

    expect(source).toContain('"4-column keypad grid"')
    expect(source).toContain("cols.size === 4")
    expect(source).toContain('"5-row keypad grid"')
    expect(source).toContain("rows.size === 5")
    expect(source).toContain('"operator keys have distinct color"')
    expect(source).toContain('"function keys have distinct color"')
    expect(source).toContain("colorDistinctFromNumbers(operatorColors)")
    expect(source).toContain("colorDistinctFromNumbers(functionColors)")
    expect(source).not.toContain("cols.size >= 3 && cols.size <= 6")
  })

  test("browser navigation uses no-activity timeout helper instead of Playwright wall-clock timeout", async () => {
    const source = await fs.readFile(AUDIT_CALCULATOR, "utf8")
    const review = await fs.readFile(
      path.resolve(import.meta.dir, "../../script/benchmark/review-deliverable.ts"),
      "utf8",
    )
    const helper = await fs.readFile(
      path.resolve(import.meta.dir, "../../script/benchmark/browser-inactivity.ts"),
      "utf8",
    )

    expect(source).toContain("gotoWithBrowserInactivity")
    expect(source).toContain("reloadWithBrowserInactivity")
    expect(source).not.toContain('page.goto(baseURL, { waitUntil: "networkidle", timeout:')
    expect(source).not.toContain('page.reload({ waitUntil: "networkidle"')
    expect(review).toContain("gotoWithBrowserInactivity")
    expect(review).not.toContain("page.goto(TARGET")
    expect(helper).toContain("browser inactive for ${inactivityTimeoutMs}ms after ${lastActivity}")
    expect(helper).toContain("browser error before idle")
    expect(helper).toContain("response.status() >= 400")
    expect(helper).toContain('page.on("requestfailed"')
    expect(helper).toContain('page.on("pageerror"')
    expect(helper).toContain("timeout: 0")
  })
})
