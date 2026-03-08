import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { ExecutorRegistry } from "./registry"
import { ExecutorDiscovery } from "./discovery"
import { CodexCLIExecutor } from "./codex-cli"
import { ClaudeCLIExecutor } from "./claude-cli"

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
      ExecutorRegistry.registerCoding("codex", CodexCLIExecutor.create({ command: found.codex.command }), {
        model: () => process.env.OPENCORVUS_EXECUTOR_CODEX_MODEL,
        cwd: () => Instance.directory,
        system: () => process.env.OPENCORVUS_EXECUTOR_CODEX_SYSTEM,
        maxTurns: () => number(process.env.OPENCORVUS_EXECUTOR_CODEX_MAX_TURNS),
      })
      log.info("registered external executor", {
        executor: "codex",
        path: found.codex.path,
        version: found.codex.version,
      })
    }

    if (found["claude-code"].available && found["claude-code"].command) {
      ExecutorRegistry.registerCoding("claude-code", ClaudeCLIExecutor.create({ command: found["claude-code"].command }), {
        model: () => process.env.OPENCORVUS_EXECUTOR_CLAUDE_MODEL,
        cwd: () => Instance.directory,
        system: () => process.env.OPENCORVUS_EXECUTOR_CLAUDE_SYSTEM,
        maxTurns: () => number(process.env.OPENCORVUS_EXECUTOR_CLAUDE_MAX_TURNS),
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
