import { NamedError } from "@opencorvus-ai/util/error"
import { existsSync } from "fs"
import fs from "fs/promises"
import os from "os"
import path from "path"
import z from "zod"
import { Config } from "@/config/config"
import { Instance } from "@/project/instance"
import { which } from "@/util/which"

export namespace TerminalProfile {
  export const ConfigError = NamedError.create(
    "TerminalProfileConfigError",
    z.object({
      message: z.string(),
    }),
  )

  export interface Resolved {
    id: string
    label: string
    command: string
    args: string[]
    env: Record<string, string>
    icon: Icon
  }

  export const Icon = z.enum(["terminal", "powershell", "command-prompt", "bash"])
  export type Icon = z.infer<typeof Icon>

  export const PublicInfo = z
    .object({
      id: z.string().min(1),
      label: z.string().min(1),
      icon: Icon,
    })
    .meta({ ref: "TerminalProfile" })

  export type PublicInfo = z.infer<typeof PublicInfo>

  export const ListResponse = z
    .object({
      defaultProfileID: z.string().min(1),
      profiles: z.array(PublicInfo),
    })
    .meta({ ref: "TerminalProfileList" })

  export type ListResponse = z.infer<typeof ListResponse>

  function normalizeForCompare(value: string): string {
    return process.platform === "win32" ? value.toLowerCase() : value
  }

  function isInside(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate)
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
  }

  export async function validateCwd(cwd: string): Promise<string> {
    if (!path.isAbsolute(cwd)) {
      throw new ConfigError({ message: `Terminal cwd must be absolute: ${cwd}` })
    }
    const rootRealPath = await fs.realpath(Instance.directory)
    const candidateRealPath = await fs.realpath(cwd)
    const root = normalizeForCompare(rootRealPath)
    const candidate = normalizeForCompare(candidateRealPath)
    if (!isInside(root, candidate)) {
      throw new ConfigError({
        message: `Terminal cwd ${cwd} must be inside project directory ${Instance.directory}`,
      })
    }
    return candidateRealPath
  }

  function resolveCommand(command: string): string {
    if (path.isAbsolute(command)) {
      if (!existsSync(command)) {
        throw new ConfigError({ message: `Terminal profile command does not exist: ${command}` })
      }
      return command
    }

    const resolved = which(command)
    if (!resolved) {
      throw new ConfigError({ message: `Terminal profile command is not resolvable: ${command}` })
    }
    return resolved
  }

  function configuredProfileIcon(profile: Config.TerminalProfile): Icon {
    return profile.icon ?? "terminal"
  }

  async function registry(): Promise<{ defaultProfileID: string; profiles: Record<string, Resolved> }> {
    const config = await Config.get()
    const terminal = config.terminal
    if (!terminal?.profiles || Object.keys(terminal.profiles).length === 0) {
      throw new ConfigError({ message: "Terminal profiles are not configured" })
    }
    if (!terminal.default_profile_id) {
      throw new ConfigError({ message: "Terminal default_profile_id is not configured" })
    }
    if (!terminal.profiles[terminal.default_profile_id]) {
      throw new ConfigError({
        message: `Terminal default_profile_id references unknown profile: ${terminal.default_profile_id}`,
      })
    }

    const profiles: Record<string, Resolved> = {}
    for (const [id, profile] of Object.entries(terminal.profiles)) {
      profiles[id] = {
        id,
        label: profile.label,
        command: resolveCommand(profile.command),
        args: [...profile.args],
        env: { ...profile.env },
        icon: configuredProfileIcon(profile),
      }
    }
    return { defaultProfileID: terminal.default_profile_id, profiles }
  }

  export async function resolve(profileID: string): Promise<Resolved> {
    const { profiles } = await registry()
    const profile = profiles[profileID]
    if (!profile) {
      throw new ConfigError({ message: `Unknown terminal profile: ${profileID}` })
    }
    return profile
  }

  export async function list(): Promise<ListResponse> {
    const result = await registry()
    return {
      defaultProfileID: result.defaultProfileID,
      profiles: Object.values(result.profiles).map((profile) => ({
        id: profile.id,
        label: profile.label,
        icon: profile.icon,
      })),
    }
  }

  function configuredSystemShell(): string | undefined {
    if (process.platform === "win32") {
      return process.env.ComSpec
    }
    return process.env.SHELL
  }

  export function setupDefaultProfile(): Config.Terminal | undefined {
    const command = configuredSystemShell()
    if (!command) return
    const label = process.platform === "win32" ? "Command Prompt" : path.basename(command)
    if (!label) return
    return {
      default_profile_id: "default",
      profiles: {
        default: {
          label,
          command,
          args: [],
          env: {
            TERM: "xterm-256color",
            COLORTERM: "truecolor",
          },
          icon: process.platform === "win32" ? "command-prompt" : "terminal",
        },
      },
    }
  }

  export async function ensureProjectDefaultProfile(): Promise<void> {
    const config = await Config.get()
    if (config.terminal?.profiles && Object.keys(config.terminal.profiles).length > 0) return

    const terminal = setupDefaultProfile()
    if (!terminal) {
      throw new ConfigError({
        message: `Cannot initialize terminal profile: ${os.platform()} has no configured system shell`,
      })
    }

    await Config.update({ terminal })
  }
}
