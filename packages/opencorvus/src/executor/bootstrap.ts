import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { ExecutorRegistry } from "./registry"
import { ExecutorDiscovery } from "./discovery"
import { ToolAdapterRegistry, protocolInfo } from "./protocol"
import { CodexCLIExecutor } from "./codex-cli"
import { CodexAppServerClientProcess } from "./codex-app-server-client"
import { CodexAppServerExecutor } from "./codex-app-server"
import { ClaudeAgentExecutor } from "./claude-agent"
import { MCPServe } from "@/mcp/serve"
import { Server } from "@/server/server"

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

    if (found.codex.available && found.codex.command && !ExecutorRegistry.has("codex")) {
      ExecutorRegistry.registerCoding("codex", codexProvider(found.codex.command), {
        model: () => process.env.OPENCORVUS_EXECUTOR_CODEX_MODEL,
        cwd: () => Instance.directory,
        system: () => process.env.OPENCORVUS_EXECUTOR_CODEX_SYSTEM,
        maxTurns: () => number(process.env.OPENCORVUS_EXECUTOR_CODEX_MAX_TURNS),
        tools: () =>
          ToolAdapterRegistry.toCodingTools(
            ToolAdapterRegistry.context({
              provider: "codex",
              capabilities: protocolInfo("codex").capabilities,
              settings: {
                cwd: Instance.directory,
              },
            }),
          ),
      })
      log.info("registered external executor", {
        executor: "codex",
        path: found.codex.path,
        version: found.codex.version,
      })
    }

    if (found["claude-code"].available && found["claude-code"].command && !ExecutorRegistry.has("claude-code")) {
      ExecutorRegistry.registerCoding("claude-code", claudeProvider(found["claude-code"].command), {
        model: () => process.env.OPENCORVUS_EXECUTOR_CLAUDE_MODEL,
        cwd: () => Instance.directory,
        system: () => process.env.OPENCORVUS_EXECUTOR_CLAUDE_SYSTEM,
        maxTurns: () => number(process.env.OPENCORVUS_EXECUTOR_CLAUDE_MAX_TURNS),
        tools: () =>
          ToolAdapterRegistry.toCodingTools(
            ToolAdapterRegistry.context({
              provider: "claude-code",
              capabilities: protocolInfo("claude-code").capabilities,
              settings: {
                cwd: Instance.directory,
              },
            }),
          ),
      })
      log.info("registered external executor", {
        executor: "claude-code",
        path: found["claude-code"].path,
        version: found["claude-code"].version,
      })
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
  if (process.env.OPENCORVUS_EXECUTOR_CODEX_PROTOCOL === "cli") {
    return CodexCLIExecutor.create({ command })
  }
  return CodexAppServerExecutor.create((cwd?: string) => {
    // Codex connects to opencorvus's embedded HTTP MCP transport at
    // /mcp/transport (single-source per CLAUDE.md rule 22 — no stdio child).
    // Codex's documented TOML schema for HTTP MCP servers is
    // `[mcp_servers.<name>] url=...`; we inject it via `-c key=value`
    // overrides. Note: if OPENCORVUS_SERVER_PASSWORD is set, codex must send
    // HTTP Basic auth, which codex 0.x does not natively support — the
    // claude-code executor handles this via the SDK's `headers` field.
    const baseUrl = Server.url()
    const config = MCPServe.url(baseUrl, { directory: cwd ?? Instance.directory })
    return CodexAppServerClientProcess.create({
      command: [
        ...command,
        "app-server",
        "--listen",
        "stdio://",
        "-c",
        `mcp_servers.${MCPServe.ServerName}.url="${config.url}"`,
      ],
      cwd,
    })
  })
}

function claudeProvider(command: string[]) {
  return ClaudeAgentExecutor.createSdk(command[0])
}
