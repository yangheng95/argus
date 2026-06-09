import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { runAudit, FORBIDDEN_BUNDLE } from "../script/audit-bundle"

/**
 * Release-bundle audit tests (plan §19.3.4 / §M8 review-grep).
 *
 * The audit runs against arbitrary files via the runAudit() entry
 * point so we can fixture both clean and dirty inputs without having
 * to actually rebuild the production esbuild output.
 */

describe("audit-bundle", () => {
  let extRoot: string

  beforeEach(() => {
    extRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opencorvus-audit-"))
    fs.mkdirSync(path.join(extRoot, "dist"), { recursive: true })
    fs.mkdirSync(path.join(extRoot, "media", "ui"), { recursive: true })
  })

  afterEach(() => {
    try {
      fs.rmSync(extRoot, { recursive: true, force: true })
    } catch {}
  })

  function withBundle(text: string): void {
    fs.writeFileSync(path.join(extRoot, "dist", "extension.cjs"), text)
  }
  function withMediaUi(name: string, text: string): void {
    fs.writeFileSync(path.join(extRoot, "media", "ui", name), text)
  }

  test("clean bundle has no violations", () => {
    withBundle(`var x = 1; OPENCORVUS_DEV_BINARY:void 0`) // object-key with undefined is OK
    const result = runAudit({
      bundlePath: path.join(extRoot, "dist", "extension.cjs"),
      mediaUiDir: path.join(extRoot, "media", "ui"),
    })
    expect(result.violations).toHaveLength(0)
  })

  test("flags live process.env.OPENCORVUS_DEV_BINARY read", () => {
    withBundle(`if (process.env.OPENCORVUS_DEV_BINARY) { /* dev path */ }`)
    const result = runAudit({
      bundlePath: path.join(extRoot, "dist", "extension.cjs"),
      mediaUiDir: path.join(extRoot, "media", "ui"),
    })
    expect(result.violations.some((v) => v.pattern.includes("OPENCORVUS_DEV_"))).toBe(true)
  })

  test('flags live process.env["OPENCORVUS_DEV_UI"] read', () => {
    withBundle(`var v = process.env["OPENCORVUS_DEV_UI"];`)
    const result = runAudit({
      bundlePath: path.join(extRoot, "dist", "extension.cjs"),
      mediaUiDir: path.join(extRoot, "media", "ui"),
    })
    expect(result.violations.some((v) => v.pattern.includes("OPENCORVUS_DEV_"))).toBe(true)
  })

  test("flags hard-coded 127.0.0.1 string in bundle", () => {
    withBundle(`fetch("http://127.0.0.1:7878/health")`)
    const result = runAudit({
      bundlePath: path.join(extRoot, "dist", "extension.cjs"),
      mediaUiDir: path.join(extRoot, "media", "ui"),
    })
    expect(result.violations.some((v) => v.pattern.includes("127.0.0.1"))).toBe(true)
  })

  test("flags fallback marker in extension bundle", () => {
    withBundle(`var note = "fallback path";`)
    const result = runAudit({
      bundlePath: path.join(extRoot, "dist", "extension.cjs"),
      mediaUiDir: path.join(extRoot, "media", "ui"),
    })
    expect(result.violations.some((v) => v.pattern.includes("fallback"))).toBe(true)
  })

  test("flags 兜底 / 降级 markers (zh) in extension bundle", () => {
    withBundle(`var t = "兜底处理路径";`)
    const a = runAudit({
      bundlePath: path.join(extRoot, "dist", "extension.cjs"),
      mediaUiDir: path.join(extRoot, "media", "ui"),
    })
    expect(a.violations.some((v) => v.matches.some((m) => m.includes("兜底")))).toBe(true)

    withBundle(`var t = "降级路径";`)
    const b = runAudit({
      bundlePath: path.join(extRoot, "dist", "extension.cjs"),
      mediaUiDir: path.join(extRoot, "media", "ui"),
    })
    expect(b.violations.some((v) => v.matches.some((m) => m.includes("降级")))).toBe(true)
  })

  test("media/ui carries its own narrower profile — overlay's 127.0.0.1 default doesn't trip the audit", () => {
    // Overlay's services/api.ts ships DEFAULT_LOCAL_SERVER_URL =
    // "127.0.0.1:7878" for Tauri mode. Vscode-transport overrides
    // the actual fetch so the literal is inert — the audit
    // legitimately permits it inside media/ui.
    fs.mkdirSync(path.join(extRoot, "media", "ui", "assets"), { recursive: true })
    fs.writeFileSync(
      path.join(extRoot, "media", "ui", "assets", "overlay.js"),
      `var DEFAULT = "127.0.0.1:7878"; var note = "fallback for tauri";`,
    )
    const result = runAudit({
      bundlePath: path.join(extRoot, "dist", "extension.cjs"),
      mediaUiDir: path.join(extRoot, "media", "ui"),
    })
    expect(result.violations).toHaveLength(0)
  })

  test("media/ui still flags live process.env.OPENCORVUS_DEV_* reads", () => {
    fs.mkdirSync(path.join(extRoot, "media", "ui", "assets"), { recursive: true })
    fs.writeFileSync(path.join(extRoot, "media", "ui", "assets", "x.js"), `var v = process.env.OPENCORVUS_DEV_SIDECAR;`)
    const result = runAudit({
      bundlePath: path.join(extRoot, "dist", "extension.cjs"),
      mediaUiDir: path.join(extRoot, "media", "ui"),
    })
    expect(result.violations.length).toBeGreaterThan(0)
  })

  test("FORBIDDEN_BUNDLE export is the same set the test fixture exercises", () => {
    // Sanity: the production audit runs the same patterns we test here.
    const descriptions = FORBIDDEN_BUNDLE.map((p) => p.description)
    expect(descriptions).toContain("live process.env read of OPENCORVUS_DEV_*")
    expect(descriptions).toContain("hard-coded 127.0.0.1 in extension bundle")
    expect(descriptions.some((d) => d.includes("fallback"))).toBe(true)
  })
})
