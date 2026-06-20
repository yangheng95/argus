import { expect, test } from "bun:test"
import fs from "node:fs"
import path from "node:path"

const SCRIPT_PATH = path.join(
  import.meta.dir,
  "..",
  "..",
  "script",
  "benchmark",
  "browser-preview-repair-pressure.ts",
)

const src = fs.readFileSync(SCRIPT_PATH, "utf8")

test("browser preview repair pressure benchmark uses inactivity timeout and explicit Bun test timeout", () => {
  expect(src).toContain("Shell.run(command, { cwd: packageRoot, idleTimeoutMs })")
  expect(src).toContain('"--idle-timeout-ms"')
  expect(src).toContain('"--per-test-timeout-ms"')
  expect(src).toContain('"--timeout"')
  expect(src).toContain("perTestTimeoutMs")
  expect(src).toContain("idle_timeout_ms=${idleTimeoutMs}")
  expect(src).toContain("status=idle_timeout")
  expect(src).not.toContain("Bun.spawn")
  expect(src).not.toContain("proc.exited")
  expect(src).not.toContain("Date.now()")
  expect(src).not.toContain("timeoutMs:")
})

test("browser preview repair pressure benchmark keeps the full pressure test surface", () => {
  for (const file of [
    "test/browser-preview/local-module-source-binding.test.ts",
    "test/browser-preview/region-comparison.test.ts",
    "test/browser-preview/region-visible-locator.test.ts",
    "test/browser-preview/region-source-bbox.test.ts",
    "test/browser-preview/region-route-diagnostics.test.ts",
    "test/browser-preview/region-route-state.test.ts",
    "test/browser-preview/region-strict-schema.test.ts",
    "test/agent/runner-prompt.test.ts",
    "test/tool/browser-preview.test.ts",
    "test/server/browser-preview-routes.test.ts",
    "test/server/browser-preview-sdk-contract.test.ts",
    "test/build-agent/reference-comparison-report.test.ts",
    "test/visual-qa/output-tools.test.ts",
    "test/visual-qa/agent.test.ts",
    "test/visual-qa/strict-reference-fidelity.test.ts",
    "test/integrity/acceptance-tools.test.ts",
    "test/integrity/browser-preview-tool.test.ts",
    "test/integrity/team-agent.test.ts",
    "test/engine/workflow-integrity-step.test.ts",
    "test/orchestrator/orchestrator-tool-descriptions.test.ts",
  ]) {
    expect(src).toContain(`"${file}"`)
  }
})
