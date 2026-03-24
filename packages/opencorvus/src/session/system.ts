import os from "os"
import { Instance } from "../project/instance"
import { Shell } from "@/shell/shell"
import { Config } from "@/config/config"

import PROMPT_CODEX from "./prompt/codex_header.txt"
import PROMPT_ANTHROPIC from "./prompt/anthropic.txt"
import PROMPT_BEAST from "./prompt/beast.txt"
import PROMPT_CODEX_GPT from "./prompt/codex.txt"
import PROMPT_GEMINI from "./prompt/gemini.txt"
import PROMPT_DEFAULT from "./prompt/default.txt"
import type { Provider } from "@/provider/provider"

// Note: instructions() removed per upstream PR #18337 — system prompt is now
// unified and placed in options.instructions for OpenAI OAuth sessions in llm.ts

const TUI_WORKFLOW = [
  "<tui-workflow>",
  "If the `tui` tool is available, prefer this control flow for deterministic TUI automation:",
  "1) Call `tui` with action `status` first.",
  "2) If runtime is not running and you need managed control, call `tui` with action `start`.",
  "3) Submit work via `tui` action `submit_task` (preferred) or `append_prompt` + `submit_prompt`.",
  "4) Use `tui` action `status` to monitor runtime and session progress.",
  "5) Use `tui` action `execute_command` only for explicit UI commands (open dialogs, cycling, paging).",
  "6) Avoid blind command chains; always check `status` before and after major actions.",
  "Command aliases are exposed by `tui.status.commands.aliases`.",
  "</tui-workflow>",
].join("\n")

function platformName(): string {
  switch (process.platform) {
    case "win32":
      return "Windows"
    case "darwin":
      return "macOS"
    case "linux":
      return "Linux"
    default:
      return process.platform
  }
}

function displayServer(): string | undefined {
  if (process.platform !== "linux") return undefined
  if (process.env.WAYLAND_DISPLAY) return process.env.DISPLAY ? "Wayland (XWayland available)" : "Wayland"
  if (process.env.DISPLAY) return "X11"
  return "headless"
}

function utcOffset(now: Date): string {
  const min = -now.getTimezoneOffset()
  const sign = min >= 0 ? "+" : "-"
  const abs = Math.abs(min)
  const h = String(Math.floor(abs / 60)).padStart(2, "0")
  const m = String(abs % 60).padStart(2, "0")
  return `${sign}${h}:${m}`
}

export namespace SystemPrompt {
  function selectProviderPrompt(modelId: string): string {
    if (modelId.includes("claude")) return PROMPT_ANTHROPIC
    if (modelId.includes("gpt-4") || modelId.includes("o1") || modelId.includes("o3")) return PROMPT_BEAST
    if (modelId.includes("gpt")) return PROMPT_CODEX_GPT
    if (modelId.includes("gemini-")) return PROMPT_GEMINI
    return PROMPT_DEFAULT
  }

  export async function provider(model: Provider.Model) {
    const cfg = await Config.get()
    const override = cfg.prompt?.["core_header"]
    if (override) return [override]
    return [selectProviderPrompt(model.api.id)]
  }

  export async function environment(model: Provider.Model) {
    const project = Instance.project
    const platform = platformName()
    const arch = process.arch
    const hostname = os.hostname()
    const shell = Shell.acceptable()
    const display = displayServer()
    const now = new Date()
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown"

    return [
      [
        `You are powered by the model named ${model.api.id}. The exact model ID is ${model.providerID}/${model.api.id}`,
        `Here is some useful information about the environment you are running in:`,
        `<env>`,
        `  Working directory: ${Instance.directory}`,
        `  Is directory a git repo: ${project.vcs === "git" ? "yes" : "no"}`,
        `  Platform: ${platform} (${arch})`,
        `  Hostname: ${hostname}`,
        `  Shell: ${shell}`,
        ...(display ? [`  Display-Server: ${display}`] : []),
        `  Today's date: ${now.toDateString()}`,
        `  Current time (ISO-8601): ${now.toISOString()}`,
        `  Local timezone: ${zone} (UTC${utcOffset(now)})`,
        `</env>`,
      ].join("\n"),
      TUI_WORKFLOW,
    ]
  }
}
