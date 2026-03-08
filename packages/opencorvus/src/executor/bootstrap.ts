import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { ExecutorRegistry } from "./registry"
import { ExecutorDiscovery } from "./discovery"
import type { CodingProvider } from "./compat"
import { ToolAdapterRegistry, protocolInfo } from "./protocol"
import { CodexCLIExecutor } from "./codex-cli"
import { CodexAppServerClientProcess } from "./codex-app-server-client"
import { CodexAppServerExecutor } from "./codex-app-server"
import { ClaudeCLIExecutor } from "./claude-cli"
import { ClaudeAgentExecutor } from "./claude-agent"

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

    if (found["claude-code"].available && found["claude-code"].command) {
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
  return fallback(
    CodexAppServerExecutor.create(() =>
      CodexAppServerClientProcess.create({
        command: [...command, "app-server", "--listen", "stdio://"],
      }),
    ),
    CodexCLIExecutor.create({ command }),
  )
}

function claudeProvider(command: string[]) {
  if (process.env.OPENCORVUS_EXECUTOR_CLAUDE_PROTOCOL === "cli") {
    return ClaudeCLIExecutor.create({ command })
  }
  return fallback(ClaudeAgentExecutor.createSdk(), ClaudeCLIExecutor.create({ command }))
}

function fallback(primary: CodingProvider, secondary: CodingProvider): CodingProvider {
  return {
    name: primary.name,
    capabilities() {
      return primary.capabilities()
    },
    async *run(input: Parameters<typeof primary.run>[0]) {
      try {
        yield* primary.run(input)
        return
      } catch (error) {
        log.warn("primary executor protocol failed, falling back", {
          provider: primary.name,
          error: error instanceof Error ? error.message : String(error),
        })
        yield* secondary.run(input)
      }
    },
    async *resume(input: Parameters<typeof primary.resume>[0]) {
      try {
        yield* primary.resume(input)
        return
      } catch (error) {
        log.warn("primary executor protocol resume failed, falling back", {
          provider: primary.name,
          error: error instanceof Error ? error.message : String(error),
        })
        yield* secondary.resume(input)
      }
    },
    async interrupt(sessionID: string) {
      try {
        return await primary.interrupt(sessionID)
      } catch (error) {
        log.warn("primary executor protocol interrupt failed, falling back", {
          provider: primary.name,
          error: error instanceof Error ? error.message : String(error),
        })
        return secondary.interrupt(sessionID)
      }
    },
    async respond(input: Parameters<NonNullable<typeof primary.respond>>[0]) {
      if (!primary.respond) return false
      return primary.respond(input)
    },
  }
}
