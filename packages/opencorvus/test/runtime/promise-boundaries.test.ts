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
  expect(lspIndex).toContain("LSPServer.spawnStdio(item.command[0], item.command.slice(1)")
  expect(lspIndex).not.toContain('from "child_process"')

  const lspServer = source("lsp/server.ts")
  expect(lspServer).toContain("ProcessSupervisor.terminateProcessTree(proc.pid")
  expect(lspServer).not.toContain("process.kill(-proc.pid")

  const bashTool = source("tool/bash.ts")
  expect(bashTool).toContain("void supervisor.exited")
  expect(bashTool).toContain(".catch(() => undefined)")
  expect(bashTool).toContain("ProcessSupervisor.terminateAndWaitForExit")
  expect(bashTool).toContain("ProcessSupervisor.disposeAndWaitForExit")
  expect(bashTool).not.toContain("void terminate()")
  expect(bashTool).not.toContain("void supervisor.dispose()")

  const sessionShell = source("session/shell-exec.ts")
  expect(sessionShell).toContain("ProcessSupervisor.terminateAndWaitForExit")
  expect(sessionShell).toContain("ProcessSupervisor.disposeAndWaitForExit")
  expect(sessionShell).not.toContain("void terminate()")

  const orchestratorTools = source("orchestrator/tools.ts")
  expect(orchestratorTools).toContain("ProcessSupervisor.terminateAndWaitForExit")
  expect(orchestratorTools).toContain("ProcessSupervisor.disposeAndWaitForExit")
  expect(orchestratorTools).not.toContain("void terminate()")

  const serveCommand = source("cli/cmd/serve.ts")
  expect(serveCommand).toContain("void shutdown")
  expect(serveCommand).toContain("[serve] shutdown failed")

  const sidecarCommand = source("cli/cmd/sidecar.ts")
  expect(sidecarCommand).toContain("void shutdown")
  expect(sidecarCommand).toContain('log.error("shutdown failed"')

  const browserMcpSessions = source("mcp/browser/sessions.ts")
  expect(browserMcpSessions).toContain("session expiration cleanup failed")
  expect(browserMcpSessions).not.toContain("await destroySession(id).catch(() => {})")

  const processSupervisor = source("shell/process-supervisor.ts")
  expect(processSupervisor).toContain("export async function terminateProcessTree")
  expect(processSupervisor).toContain("export async function terminateProcessGroup")
  expect(processSupervisor).not.toContain("taskkill.exe")
  expect(processSupervisor).not.toContain("wmic")
  expect(processSupervisor).toContain('spawn(helper, ["--kill-tree", String(pid)]')
  expect(processSupervisor).toContain('spawnSync("pgrep", ["-P", String(pid)]')
  expect(processSupervisor).toContain('code === "ESRCH"')
  expect(processSupervisor).not.toContain("if (!processIsRunning(pid)) return\n    process.kill(pid, signal)")

  const processUtil = source("util/process.ts")
  expect(processUtil).toContain('import { ProcessSupervisor } from "@/shell/process-supervisor"')
  expect(processUtil).toContain("detached: process.platform !== \"win32\"")
  expect(processUtil).toContain("if (!closed) rejectExited?.(failure)")
  expect(processUtil).toContain("ProcessSupervisor.terminateAndWaitForExit(handle")
  expect(processUtil).toContain('await ProcessSupervisor.disposeAndWaitForExit(handle, "Process.run")')
  expect(processUtil).toContain("ProcessSupervisor.terminateProcessGroup(proc.pid")
  expect(processUtil).toContain("ProcessSupervisor.terminateProcessTree(proc.pid")
  expect(processUtil).toContain("ProcessSupervisor.spawnCommand")

  const pluginToolHost = source("tool/plugin-tool-host.ts")
  expect(pluginToolHost).toContain("ProcessSupervisor.spawnCommand")
  expect(pluginToolHost).toContain("await ProcessSupervisor.disposeAndWaitForExit(handle")
  expect(processUtil).toContain("let closed = false")
  expect(processUtil).toContain("Process did not close after tree cleanup")
  expect(processUtil).not.toContain("proc.exitCode !== null || proc.signalCode !== null")
  expect(processUtil).not.toContain("proc.kill(kill)")
  expect(processUtil).not.toContain('proc.kill("SIGKILL")')

  const externalProcess = source("executor/external-process.ts")
  expect(externalProcess).toContain("AsyncIterableIterator<Record<string, unknown>>")
  expect(externalProcess).toContain("async return()")
  expect(externalProcess).toContain("if (!exitError)")
  expect(externalProcess).not.toContain("export async function* jsonLines")
  expect(processUtil).not.toContain("kill?: NodeJS.Signals")
  expect(processUtil).not.toContain("opts.kill")
  expect(externalProcess).toContain("await proc.terminate()")
  expect(externalProcess).not.toContain('proc.terminate("SIGTERM")')
  expect(externalProcess).not.toContain("proc.exitCode === null && proc.signalCode === null")
})

test("external session cleanup uses EngineService delete", () => {
  const controlMessage = source("control/message.ts")
  expect(controlMessage).toContain("EngineService.deleteSession(control!.info.id)")
  expect(controlMessage).not.toContain("Session.remove(control!.info.id)")

  const mcpServe = source("mcp/serve.ts")
  expect(mcpServe).toContain("EngineService.deleteSession(session.id)")
  expect(mcpServe).not.toContain("Session.remove(session.id)")
})
