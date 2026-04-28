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
    const mcp = MCPServe.command(cwd ?? Instance.directory)
    return CodexAppServerClientProcess.create({
      command: [
        ...command,
        // Top-level option: `--dangerously-bypass-approvals-and-sandbox`
        // collapses every confirmation pathway codex 0.125 still emits
        // even after `approvalPolicy=never`/`--disable tool_call_mcp_elicitation`
        // — most importantly the `mcp_tool_call_approval_*` elicitation
        // that comes through `item/tool/requestUserInput` for every tool
        // call. We caught this on the 2026-04-29 dispatch (codex 0.125
        // build-agents stalling with `tool_call ... ended without a
        // matching tool_result`): host received a multiple-choice
        // {Allow, Allow for this session, Cancel} elicitation, auto-replied
        // free text, codex treated it as Cancel, the tool never ran.
        // The bypass flag is the same operating mode claude-code uses for
        // its sandbox; benchmark runs are externally sandboxed (per-goal
        // worktrees + ephemeral home), so the safety surface is the host,
        // not codex's per-call gates.
        "--dangerously-bypass-approvals-and-sandbox",
        "app-server",
        "--listen",
        "stdio://",
        // Belt-and-braces: disable the elicitation feature explicitly too.
        // The bypass flag should already cover this, but keeping the
        // feature toggle off means even if a future codex release re-routes
        // an approval pathway around the bypass, we're still clear.
        "--disable",
        "tool_call_mcp_elicitation",
        "--disable",
        "guardian_approval",
        "-c",
        `mcp_servers.${MCPServe.ServerName}.command="${mcp.command}"`,
        "-c",
        `mcp_servers.${MCPServe.ServerName}.args=${JSON.stringify(mcp.args)}`,
      ],
      cwd,
    })
  })
}

function claudeProvider(command: string[]) {
  return ClaudeAgentExecutor.createSdk(command[0])
}
