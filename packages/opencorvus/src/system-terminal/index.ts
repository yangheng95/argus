import { NamedError } from "@opencorvus-ai/util/error"
import { existsSync } from "fs"
import path from "path"
import z from "zod"
import { Plugin } from "@/plugin"
import { TerminalProfile } from "@/system-terminal/profile"
import { which } from "@/util/which"

export namespace SystemTerminal {
  export const ConfigError = NamedError.create(
    "SystemTerminalConfigError",
    z.object({
      message: z.string(),
    }),
  )

  export const OpenInput = z.object({
    cwd: z.string().min(1),
    profileID: z.string().min(1).optional(),
  })
  export type OpenInput = z.infer<typeof OpenInput>

  export const OpenResponse = z.object({ ok: z.boolean() }).meta({ ref: "SystemTerminalOpenResponse" })
  export type OpenResponse = z.infer<typeof OpenResponse>

  export interface CommandSpec {
    command: string
    args: string[]
  }

  export interface BuildOptions {
    platform: NodeJS.Platform
    cwd: string
    terminalApp: string
    profile?: Pick<TerminalProfile.Resolved, "command" | "args">
    command?: string
    args?: string[]
    keepOpen?: boolean
    defaultShell?: string
  }

  function resolveExecutable(command: string): string {
    if (path.isAbsolute(command)) {
      if (!existsSync(command)) {
        throw new ConfigError({ message: `System terminal executable does not exist: ${command}` })
      }
      return command
    }
    const resolved = which(command)
    if (!resolved) {
      throw new ConfigError({ message: `System terminal executable is not resolvable: ${command}` })
    }
    return resolved
  }

  function terminalApp(): string {
    const configured = process.env.OPENCORVUS_SYSTEM_TERMINAL_BIN?.trim()
    if (configured) return resolveExecutable(configured)
    if (process.platform === "win32") return resolveExecutable("wt.exe")
    if (process.platform === "darwin") return resolveExecutable("/usr/bin/osascript")
    return resolveExecutable("x-terminal-emulator")
  }

  async function validateCwd(cwd: string): Promise<string> {
    try {
      return await TerminalProfile.validateCwd(cwd)
    } catch (error) {
      if (error instanceof TerminalProfile.ConfigError) {
        throw new ConfigError({ message: error.data.message })
      }
      throw error
    }
  }

  function shellQuote(value: string): string {
    return `'${value.replaceAll("'", "'\"'\"'")}'`
  }

  function cmdQuote(value: string): string {
    return `"${value.replaceAll('"', '""')}"`
  }

  function appleScriptString(value: string): string {
    return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`
  }

  function defaultInteractiveShell(input?: string): string {
    return input?.trim() || process.env.SHELL?.trim() || "sh"
  }

  function commandArgv(options: BuildOptions): string[] {
    if (options.command) return [options.command, ...(options.args ?? [])]
    if (options.profile) return [options.profile.command, ...options.profile.args]
    return []
  }

  function shellLine(options: BuildOptions): string {
    const argv = commandArgv(options)
    const prefix = `cd ${shellQuote(options.cwd)}`
    if (argv.length === 0) return `${prefix}; exec ${shellQuote(defaultInteractiveShell(options.defaultShell))} -i`
    const command = argv.map(shellQuote).join(" ")
    if (options.keepOpen) {
      return `${prefix} && ${command}; exec ${shellQuote(defaultInteractiveShell(options.defaultShell))} -i`
    }
    return `${prefix}; exec ${command}`
  }

  export function buildCommand(options: BuildOptions): CommandSpec {
    const argv = commandArgv(options)
    if (options.platform === "win32") {
      if (options.command) {
        return {
          command: options.terminalApp,
          args: ["-d", options.cwd, "cmd.exe", "/k", argv.map(cmdQuote).join(" ")],
        }
      }
      return {
        command: options.terminalApp,
        args: argv.length > 0 ? ["-d", options.cwd, ...argv] : ["-d", options.cwd],
      }
    }

    if (options.platform === "darwin") {
      const script = [
        'tell application "Terminal"',
        "activate",
        `do script ${appleScriptString(shellLine(options))}`,
        "end tell",
      ].join("\n")
      return { command: options.terminalApp, args: ["-e", script] }
    }

    return {
      command: options.terminalApp,
      args: ["-e", "sh", "-lc", shellLine(options)],
    }
  }

  async function launch(spec: CommandSpec, cwd: string, env: Record<string, string>): Promise<OpenResponse> {
    const child = Bun.spawn([spec.command, ...spec.args], {
      cwd,
      env: {
        ...process.env,
        ...env,
      },
      stdio: ["ignore", "ignore", "ignore"],
      windowsHide: false,
    })
    child.unref()
    return { ok: true }
  }

  export async function open(input: OpenInput): Promise<OpenResponse> {
    const cwd = await validateCwd(input.cwd)
    const profile = input.profileID ? await TerminalProfile.resolve(input.profileID) : undefined
    const shellEnv = await Plugin.trigger("shell.env", { cwd }, { env: {} })
    const spec = buildCommand({
      platform: process.platform,
      cwd,
      terminalApp: terminalApp(),
      profile,
      defaultShell: process.env.SHELL,
    })
    return await launch(spec, cwd, shellEnv.env as Record<string, string>)
  }

  export async function openCommand(input: { cwd: string; command: string; args?: string[] }): Promise<OpenResponse> {
    const cwd = await validateCwd(input.cwd)
    const shellEnv = await Plugin.trigger("shell.env", { cwd }, { env: {} })
    const spec = buildCommand({
      platform: process.platform,
      cwd,
      terminalApp: terminalApp(),
      command: input.command,
      args: input.args ?? [],
      keepOpen: true,
      defaultShell: process.env.SHELL,
    })
    return await launch(spec, cwd, shellEnv.env as Record<string, string>)
  }
}
