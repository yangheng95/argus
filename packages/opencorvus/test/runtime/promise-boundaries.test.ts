import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const srcRoot = path.resolve(import.meta.dir, "../../src")

function source(relative: string) {
  return readFileSync(path.join(srcRoot, relative), "utf8")
}

test("background finally cleanup promises are observed", () => {
  const orchestratorLoop = source("orchestrator/loop.ts")
  expect(orchestratorLoop).toContain("void next")
  expect(orchestratorLoop).toContain(".finally(() => {")
  expect(orchestratorLoop).toContain("task loop cleanup failed")

  const lspIndex = source("lsp/index.ts")
  expect(lspIndex).toContain("void task")
  expect(lspIndex).toContain("lsp spawn cleanup failed")

  const bashTool = source("tool/bash.ts")
  expect(bashTool).toContain("void supervisor.exited")
  expect(bashTool).toContain(".catch(() => undefined)")

  const serveCommand = source("cli/cmd/serve.ts")
  expect(serveCommand).toContain("void shutdown")
  expect(serveCommand).toContain("[serve] shutdown failed")

  const sidecarCommand = source("cli/cmd/sidecar.ts")
  expect(sidecarCommand).toContain("void shutdown")
  expect(sidecarCommand).toContain('log.error("shutdown failed"')
})

test("external session cleanup uses EngineService delete", () => {
  const controlMessage = source("control/message.ts")
  expect(controlMessage).toContain("EngineService.deleteSession(control!.info.id)")
  expect(controlMessage).not.toContain("Session.remove(control!.info.id)")

  const mcpServe = source("mcp/serve.ts")
  expect(mcpServe).toContain("EngineService.deleteSession(session.id)")
  expect(mcpServe).not.toContain("Session.remove(session.id)")
})
