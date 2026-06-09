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

  const toolbarDiff = readText("test/browser/toolbar-diff-navigation.test.ts")
  expect(toolbarDiff).toContain('import test from "node:test"')
  expect(toolbarDiff).toContain('from "../launch.ts"')
  expect(toolbarDiff).toContain("startBrowserFixture")
  expect(toolbarDiff).toContain('typeof globalThis.Bun, "undefined"')

  const workspaceOnboarding = readText("test/browser/workspace-onboarding-browser.test.ts")
  expect(workspaceOnboarding).toContain('import test from "node:test"')
  expect(workspaceOnboarding).toContain('from "../launch.ts"')
  expect(workspaceOnboarding).toContain("startBrowserFixture")
  expect(workspaceOnboarding).toContain('typeof globalThis.Bun, "undefined"')

  const menuCollapse = readText("test/browser/menu-collapse.test.ts")
  expect(menuCollapse).toContain('import test from "node:test"')
  expect(menuCollapse).toContain('from "../launch.ts"')
  expect(menuCollapse).toContain("startBrowserFixture")
  expect(menuCollapse).toContain('typeof globalThis.Bun, "undefined"')

  const taskListTreeClick = readText("test/browser/task-list-tree-click.test.ts")
  expect(taskListTreeClick).toContain('import test from "node:test"')
  expect(taskListTreeClick).toContain('from "../launch.ts"')
  expect(taskListTreeClick).toContain("startBrowserFixture")
  expect(taskListTreeClick).toContain('typeof globalThis.Bun, "undefined"')

  const agentModelsPanel = readText("test/browser/agent-models-panel.test.ts")
  expect(agentModelsPanel).toContain('import test from "node:test"')
  expect(agentModelsPanel).toContain('from "../launch.ts"')
  expect(agentModelsPanel).toContain("startBrowserFixture")
  expect(agentModelsPanel).toContain('typeof globalThis.Bun, "undefined"')

  const copyActions = readText("test/browser/copy-actions.test.ts")
  expect(copyActions).toContain('import test from "node:test"')
  expect(copyActions).toContain('from "../launch.ts"')
  expect(copyActions).toContain("startBrowserFixture")
  expect(copyActions).toContain('typeof globalThis.Bun, "undefined"')

  const paneCollapseRail = readText("test/browser/pane-collapse-rail.test.ts")
  expect(paneCollapseRail).toContain('import test from "node:test"')
  expect(paneCollapseRail).toContain('from "../launch.ts"')
  expect(paneCollapseRail).toContain("startBrowserFixture")
  expect(paneCollapseRail).toContain('typeof globalThis.Bun, "undefined"')

  const workspaceTerminalOpen = readText("test/browser/workspace-terminal-open.test.ts")
  expect(workspaceTerminalOpen).toContain('import test from "node:test"')
  expect(workspaceTerminalOpen).toContain('from "../launch.ts"')
  expect(workspaceTerminalOpen).toContain("startBrowserFixture")
  expect(workspaceTerminalOpen).toContain('typeof globalThis.Bun, "undefined"')

  const providerAgentModelSync = readText("test/browser/provider-agent-model-sync.test.ts")
  expect(providerAgentModelSync).toContain('import test from "node:test"')
  expect(providerAgentModelSync).toContain('from "../launch.ts"')
  expect(providerAgentModelSync).toContain("startBrowserFixture")
  expect(providerAgentModelSync).toContain('typeof globalThis.Bun, "undefined"')

  const providerOauth = readText("test/browser/provider-oauth.test.ts")
  expect(providerOauth).toContain('import test from "node:test"')
  expect(providerOauth).toContain('from "../launch.ts"')
  expect(providerOauth).toContain("startBrowserFixture")
  expect(providerOauth).toContain('typeof globalThis.Bun, "undefined"')

  const dist = readText("test/overlay-dist.ts")
  expect(dist).toContain('from "node:child_process"')
  expect(dist).toContain("readFile(file)")
  expect(dist).not.toContain("Bun.spawn")
  expect(dist).not.toContain("Bun.file")
})
