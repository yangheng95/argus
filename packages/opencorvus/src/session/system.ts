import os from "os"
import { Instance } from "../project/instance"
import { Project } from "../project/project"
import { Shell } from "@/shell/shell"
import { EffectiveConfig } from "@/config/effective"
import { SkillMount } from "@/skill/mounts"

import PROMPT_SYSTEM from "./prompt/system.txt"
import type { Provider } from "@/provider/provider"
import type { Agent } from "@/agent/agent"

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
  export function responseLanguage(locale: string | undefined): string | undefined {
    if (locale === "zh-CN") {
      return [
        "## Response Language",
        "",
        "请使用简体中文进行回复。除非用户明确要求其他语言，面向用户的总结、问题、状态说明、计划和交付说明都应使用简体中文；代码、命令、文件路径、API 名称和必须保留的原文不要翻译。",
      ].join("\n")
    }
    if (locale === "en-US") {
      return [
        "## Response Language",
        "",
        "Please respond in English. Unless the user explicitly asks for another language, user-facing summaries, questions, status updates, plans, and acceptance notes should be written in English; keep code, commands, file paths, API names, and required source text unchanged.",
      ].join("\n")
    }
    return
  }

  /** Resolve the core system prompt string, respecting config.prompt.core_header override. */
  export async function instructions(): Promise<string> {
    const cfg = await EffectiveConfig.effective()
    return cfg.prompt?.["core_header"] ?? PROMPT_SYSTEM
  }

  export async function provider(model: Provider.Model, opts?: { sessionID?: string }) {
    const cfg = await EffectiveConfig.effective(opts?.sessionID ? { sessionID: opts.sessionID } : undefined)
    const override = cfg.prompt?.["core_header"]
    if (override) return [override]
    return [PROMPT_SYSTEM]
  }

  export async function environment(model: Provider.Model) {
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
        `  Workspace root folder: ${Instance.worktree}`,
        `  Is directory a git repo: ${Project.isGitRepo(Instance.directory) ? "yes" : "no"}`,
        `  Platform: ${platform} (${arch})`,
        `  Hostname: ${hostname}`,
        `  Shell: ${shell}`,
        ...(display ? [`  Display-Server: ${display}`] : []),
        `  Today's date: ${now.toDateString()}`,
        `  Local timezone: ${zone} (UTC${utcOffset(now)})`,
        `</env>`,
      ].join("\n"),
    ]
  }

  export async function skills(
    agent: Agent.Info,
    input?: { availableToolNames?: Iterable<string>; surface?: SkillMount.ResolvedAgentSkillSurface },
  ): Promise<string | undefined> {
    const surface = input?.surface ?? (await SkillMount.resolve({ agent, availableToolNames: input?.availableToolNames }))
    const compatible = surface.skills.filter((skill) => skill.enabled)
    if (compatible.length === 0) return

    return [
      "## Skill Policy",
      "",
      "Skills are curated, tested workflows for recurring task shapes (webpage cloning, spec research, acceptance verification, etc.). Each skill bundles the task contract, evidence expectations, and resource files.",
      "",
      "### Check First",
      "1. Before planning, scan `<available_skills>` below for any entry whose description matches the current task.",
      "2. If one matches, call the `skill` tool with its name to load the full instructions into context **before** you start executing.",
      "3. Follow the loaded skill's evidence and output contract rather than improvising. Do not repeat acquisition tools once the required evidence artifacts already exist.",
      "4. If several skills could apply, load the most specific one first; load additional skills only if the task spans their domains.",
      "",
      "<available_skills>",
      ...compatible.map((s) => `- ${s.name}: ${s.description}`),
      "</available_skills>",
    ].join("\n")
  }
}
