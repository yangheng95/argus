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

  interface SystemProfileDefinition {
    id: string
    label: string
    commands: string[]
    args: string[]
    icon: Icon
  }

  interface SystemProfileOptions {
    platform: NodeJS.Platform
    env: NodeJS.ProcessEnv
    resolveCommand: (command: string) => string | undefined
  }

  function uniqueStrings(values: Array<string | undefined>): string[] {
    return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => !!value))]
  }

  function systemProfileDefinitions(options: SystemProfileOptions): SystemProfileDefinition[] {
    if (options.platform === "win32") {
      return [
        {
          id: "powershell",
          label: "Windows PowerShell",
          commands: ["powershell.exe", "powershell"],
          args: ["-NoLogo"],
          icon: "powershell",
        },
        {
          id: "pwsh",
          label: "PowerShell",
          commands: ["pwsh.exe", "pwsh"],
          args: ["-NoLogo"],
          icon: "powershell",
        },
        {
          id: "cmd",
          label: "Command Prompt",
          commands: uniqueStrings([options.env.ComSpec, "cmd.exe", "cmd"]),
          args: [],
          icon: "command-prompt",
        },
        {
          id: "bash",
          label: "Bash",
          commands: ["bash.exe", "bash"],
          args: [],
          icon: "bash",
        },
      ]
    }

    return [
      {
        id: "bash",
        label: "Bash",
        commands: uniqueStrings([options.env.SHELL?.endsWith("/bash") ? options.env.SHELL : undefined, "bash"]),
        args: [],
        icon: "bash",
      },
      {
        id: "zsh",
        label: "Zsh",
        commands: uniqueStrings([options.env.SHELL?.endsWith("/zsh") ? options.env.SHELL : undefined, "zsh"]),
        args: [],
        icon: "terminal",
      },
      {
        id: "fish",
        label: "Fish",
        commands: uniqueStrings([options.env.SHELL?.endsWith("/fish") ? options.env.SHELL : undefined, "fish"]),
        args: [],
        icon: "terminal",
      },
    ]
  }

  function createSystemTerminalProfileConfig(options: SystemProfileOptions): Config.Terminal | undefined {
    const profiles: Record<string, Config.TerminalProfile> = {}
    for (const definition of systemProfileDefinitions(options)) {
      const command = definition.commands.map(options.resolveCommand).find((resolved) => !!resolved)
      if (!command) continue
      profiles[definition.id] = {
        label: definition.label,
        command,
        args: definition.args,
        env: {
          TERM: "xterm-256color",
          COLORTERM: "truecolor",
        },
        icon: definition.icon,
      }
    }
    const defaultProfileID = profiles.powershell ? "powershell" : Object.keys(profiles)[0]
    if (!defaultProfileID) return
    return {
      default_profile_id: defaultProfileID,
      profiles,
    }
  }

  export function createSystemTerminalProfilesForTest(options: SystemProfileOptions): Config.Terminal | undefined {
    return createSystemTerminalProfileConfig(options)
  }

  export function setupDefaultProfile(): Config.Terminal | undefined {
    return createSystemTerminalProfileConfig({
      platform: process.platform,
      env: process.env,
      resolveCommand(command) {
        try {
          return resolveCommand(command)
        } catch (error) {
          if (error instanceof ConfigError) return undefined
          throw error
        }
      },
    })
  }

  function isPreviousGeneratedSingleProfile(terminal: Config.Terminal): boolean {
    const command = configuredSystemShell()
    if (!command) return false
    const profiles = terminal.profiles ?? {}
    const entries = Object.entries(profiles)
    if (terminal.default_profile_id !== "default" || entries.length !== 1) return false
    const profile = profiles.default
    if (!profile) return false
    const label = process.platform === "win32" ? "Command Prompt" : path.basename(command)
    return (
      profile.label === label &&
      profile.command === command &&
      profile.args.length === 0 &&
      profile.env.TERM === "xterm-256color" &&
      profile.env.COLORTERM === "truecolor" &&
      profile.icon === (process.platform === "win32" ? "command-prompt" : "terminal")
    )
  }

  export async function ensureProjectDefaultProfile(): Promise<void> {
    const config = await Config.get()
    const shouldWrite =
      !config.terminal?.profiles ||
      Object.keys(config.terminal.profiles).length === 0 ||
      isPreviousGeneratedSingleProfile(config.terminal)
    if (!shouldWrite) return

    const terminal = setupDefaultProfile()
    if (!terminal) {
      throw new ConfigError({
        message: `Cannot initialize terminal profile: ${os.platform()} has no configured system shell`,
      })
    }

    const removePreviousDefault = config.terminal?.profiles?.default ? { default: null } : {}
    await Config.update({
      terminal: {
        ...terminal,
        profiles: {
          ...removePreviousDefault,
          ...terminal.profiles,
        },
      },
    } as Config.Info)
  }
}
