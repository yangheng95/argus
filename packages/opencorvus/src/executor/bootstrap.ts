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
import { EngineConfig } from "@/engine/config"
import { codingRuntimeEnv } from "./contract"
import type { CodingRunInfo } from "./contract"

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
  return CodexAppServerExecutor.create(
    async (runtime?: Pick<CodingRunInfo, "cwd" | "taskID" | "logicalSessionID" | "runtimeDir" | "worktreeDir">) => {
      const cfg = await EngineConfig.get()
      const cwd = runtime?.cwd
      const mcp = MCPServe.command(cwd ?? Instance.directory)
      const enabledTools = await MCPServe.toolDefinitions("executor").then(codexMcpEnabledTools)
      const runtimeEnv = codingRuntimeEnv(runtime ?? {})
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
          "app-server",
          "--listen",
          "stdio://",
          // codex 0.125 app-server IGNORES the top-level
          // `--dangerously-bypass-approvals-and-sandbox` flag (only honored
          // by interactive CLI). The developer prompt that codex sends to
          // every model turn proves this — without these `-c` overrides the
          // session reports `sandbox_mode: workspace-write` even though
          // global ~/.codex/config.toml is `danger-full-access`. The app-
          // server resolves config from CLI args first, then falls back to
          // the file; missing args = whatever the app-server defaults to,
          // which on 0.125 is the conservative workspace-write.
          // Caught on bench round-4 _session-20260429-080644.out 00:36:58:
          // codex backend goal hit `EACCES` binding 127.0.0.1:3001 because
          // network sandbox was still enforced.
          "-c",
          `sandbox_mode="danger-full-access"`,
          "-c",
          `approval_policy="never"`,
          // Belt-and-braces: disable the elicitation feature explicitly too.
          "--disable",
          "tool_call_mcp_elicitation",
          "--disable",
          "guardian_approval",
          "-c",
          `mcp_servers.${MCPServe.ServerName}.command=${JSON.stringify(mcp.command)}`,
          "-c",
          `mcp_servers.${MCPServe.ServerName}.args=${JSON.stringify(mcp.args)}`,
          "-c",
          `mcp_servers.${MCPServe.ServerName}.env=${tomlInlineStringMap(runtimeEnv)}`,
          "-c",
          `mcp_servers.${MCPServe.ServerName}.enabled_tools=${tomlStringArray(enabledTools)}`,
          // The canonical codex-blessed way to silence per-tool approval
          // prompts on a trusted MCP server. Without this, codex 0.125 emits
          // `mcp_tool_call_approval_<callID>` elicitations for every memory /
          // task_report / webpage_* call from our own opencorvus MCP server,
          // even with --disable tool_call_mcp_elicitation. Documented at
          // docs/config.md (openai/codex repo): set
          // `default_tools_approval_mode = "approve"` on the server entry to
          // auto-approve every tool call. This is OUR mcp server, fully
          // trusted; per-call user prompts add zero safety surface.
          "-c",
          `mcp_servers.${MCPServe.ServerName}.default_tools_approval_mode="approve"`,
        ],
        cwd,
        env: {
          ...process.env,
          ...runtimeEnv,
        },
        requestIdleMs: cfg.activity.executor_events_idle_ms,
      })
    },
  )
}

function claudeProvider(command: string[]) {
  return ClaudeAgentExecutor.createSdk(command[0])
}

function codexMcpEnabledTools(tools: Awaited<ReturnType<typeof MCPServe.toolDefinitions>>) {
  const names = tools.map((tool) => tool.name)
  const seen = new Set<string>()
  const duplicated = new Set<string>()
  for (const name of names) {
    if (seen.has(name)) duplicated.add(name)
    seen.add(name)
  }
  if (duplicated.size > 0) {
    throw new Error(`Duplicate Codex MCP enabled tool names: ${Array.from(duplicated).sort().join(", ")}`)
  }
  return names.sort((left, right) => left.localeCompare(right))
}

function tomlInlineStringMap(input: Record<string, string>) {
  const entries = Object.entries(input)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${tomlString(key)} = ${tomlString(value)}`)
  if (entries.length === 0) return "{}"
  return `{ ${entries.join(", ")} }`
}

function tomlStringArray(input: string[]) {
  return `[${input.map(tomlString).join(", ")}]`
}

function tomlString(input: string) {
  return `"${input.replace(/[\b\t\n\f\r"\\]/g, (char) => {
    if (char === "\b") return "\\b"
    if (char === "\t") return "\\t"
    if (char === "\n") return "\\n"
    if (char === "\f") return "\\f"
    if (char === "\r") return "\\r"
    if (char === '"') return '\\"'
    return "\\\\"
  })}"`
}
