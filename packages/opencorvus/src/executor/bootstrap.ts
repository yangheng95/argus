import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { ExecutorRegistry } from "./registry"
import { ExecutorDiscovery } from "./discovery"
import { CodexAppServerClientProcess } from "./codex-app-server-client"
import { CodexAppServerExecutor } from "./codex-app-server"
import { ClaudeAgentExecutor } from "./claude-agent"
import { MCPServe } from "@/mcp/serve"

const log = Log.create({ service: "executor.bootstrap" })

const state = {
  done: false,
}

export namespace ExecutorBootstrap {
  export async function autoRegister(force = false) {
    if (!force && state.done) return ExecutorDiscovery.scan()
    if (!force && process.env.OPENCORVUS_AUTO_DISCOVER_EXECUTORS !== "1") return ExecutorDiscovery.scan()
    state.done = true

    const found = await ExecutorDiscovery.scan()

    if (found.codex.available && found.codex.command) {
      if (ExecutorRegistry.has("codex")) {
        log.info("skipping auto-register for existing executor", {
          executor: "codex",
          path: found.codex.path,
          version: found.codex.version,
        })
      } else {
        ExecutorRegistry.registerCoding("codex", codexProvider(found.codex.command), {
          model: () => process.env.OPENCORVUS_EXECUTOR_CODEX_MODEL,
          cwd: () => Instance.directory,
          system: () => process.env.OPENCORVUS_EXECUTOR_CODEX_SYSTEM,
          maxTurns: () => number(process.env.OPENCORVUS_EXECUTOR_CODEX_MAX_TURNS),
          planning: {
            spec: true,
            plan: true,
          },
        })
        log.info("registered external executor", {
          executor: "codex",
          path: found.codex.path,
          version: found.codex.version,
        })
      }
    }

    if (found["claude-code"].available && found["claude-code"].command) {
      if (ExecutorRegistry.has("claude-code")) {
        log.info("skipping auto-register for existing executor", {
          executor: "claude-code",
          path: found["claude-code"].path,
          version: found["claude-code"].version,
        })
      } else {
        ExecutorRegistry.registerCoding("claude-code", claudeProvider(found["claude-code"].command), {
          model: () => process.env.OPENCORVUS_EXECUTOR_CLAUDE_MODEL,
          cwd: () => Instance.directory,
          system: () => process.env.OPENCORVUS_EXECUTOR_CLAUDE_SYSTEM,
          maxTurns: () => number(process.env.OPENCORVUS_EXECUTOR_CLAUDE_MAX_TURNS),
          planning: {
            spec: false,
            plan: false,
          },
        })
        log.info("registered external executor", {
          executor: "claude-code",
          path: found["claude-code"].path,
          version: found["claude-code"].version,
        })
      }
    }

    return found
  }
}

function number(value: string | undefined) {
  const next = Number(value)
  if (!Number.isFinite(next) || next <= 0) return undefined
  return Math.floor(next)
}

function codexProvider(command: string[]) {
  return CodexAppServerExecutor.create(() => {
    const mcp = MCPServe.command(Instance.directory)
    return CodexAppServerClientProcess.create({
      command: [
        ...command,
        "app-server",
        "--listen",
        "stdio://",
        "-c",
        `mcp_servers.opencorvus.command=${JSON.stringify(mcp.command)}`,
        "-c",
        `mcp_servers.opencorvus.args=${JSON.stringify(mcp.args)}`,
        ...Object.entries(mcp.env).flatMap(([key, value]) => [
          "-c",
          `mcp_servers.opencorvus.env.${key}=${JSON.stringify(value)}`,
        ]),
      ],
    })
  })
}

function claudeProvider(command: string[]) {
  return ClaudeAgentExecutor.createSdk()
}
