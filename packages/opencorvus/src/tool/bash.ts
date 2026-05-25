import z from "zod"
import { spawn } from "child_process"
import { Tool } from "./tool"
import path from "path"
import fs from "fs/promises"
import DESCRIPTION from "./bash.txt"
import { Log } from "../util/log"
import { Instance } from "../project/instance"
import { lazy } from "@/util/lazy"
import { Language } from "web-tree-sitter"

import { Filesystem } from "@/util/filesystem"
import { fileURLToPath } from "url"
import { Flag } from "@/flag/flag.ts"
import { Shell } from "@/shell/shell"
import { BASH_BACKGROUND_READINESS_MAX_MS, DEFAULT_BASH_TIMEOUT_MS } from "@/shell/timeout"

import { BashArity } from "@/permission/arity"
import { Truncate } from "./truncation"
import { Plugin } from "@/plugin"
import { PidGuard } from "@/shell/pid-guard"
import { gitCeilingEnvForWorktree } from "@/worktree/git-ceiling"

const MAX_METADATA_LENGTH = 30_000
export const DEFAULT_TIMEOUT = Flag.OPENCORVUS_EXPERIMENTAL_BASH_DEFAULT_TIMEOUT_MS || DEFAULT_BASH_TIMEOUT_MS

export const log = Log.create({ service: "bash-tool" })
const DYNAMIC_PATH_PATTERN = /[*?[\]{}$`~]/
const FORBIDDEN_ENV_KEYS = new Set(["LD_PRELOAD", "LD_AUDIT", "DYLD_INSERT_LIBRARIES", "DYLD_FORCE_FLAT_NAMESPACE"])

// Commands that kill processes by name — can destroy the host process (benchmark,
// server, other executors) when run inside an isolated worktree. Worktree isolation
// protects the filesystem but NOT the process namespace.
const HOST_KILLING_PATTERNS = [
  /\btaskkill\b.*\/IM\b/i,                      // taskkill /F /IM bun.exe
  /\bStop-Process\b.*-Name\b/i,                  // Stop-Process -Name 'bun'
  /\bkillall\b/i,                                // killall bun
  /\bpkill\b/i,                                  // pkill bun
  /\bwmic\b.*process.*\bcall\b.*terminate/i,     // wmic process where name="bun.exe" call terminate
  /\bxargs\s+kill\b/i,                           // ps | grep bun | xargs kill
  /\bxargs\s+.*\bkill\b/i,                       // ps | xargs -I{} kill {}
  /\bkill\b.*\$\(/i,                             // kill $(pgrep bun)
  /\bkill\b.*`/i,                                // kill `pgrep bun`
]

export function isHostKillingCommand(command: string): boolean {
  return HOST_KILLING_PATTERNS.some(pattern => pattern.test(command))
}

const resolveWasm = (asset: string) => {
  if (asset.startsWith("file://")) return fileURLToPath(asset)
  if (asset.startsWith("/") || /^[a-z]:/i.test(asset)) return asset
  const url = new URL(asset, import.meta.url)
  return fileURLToPath(url)
}

const parser = lazy(async () => {
  const { Parser } = await import("web-tree-sitter")
  const { default: treeWasm } = await import("web-tree-sitter/tree-sitter.wasm" as string, {
    with: { type: "wasm" },
  })
  const treePath = resolveWasm(treeWasm)
  await Parser.init({
    locateFile() {
      return treePath
    },
  })
  const { default: bashWasm } = await import("tree-sitter-bash/tree-sitter-bash.wasm" as string, {
    with: { type: "wasm" },
  })
  const bashPath = resolveWasm(bashWasm)
  const bashLanguage = await Language.load(bashPath)
  const p = new Parser()
  p.setLanguage(bashLanguage)
  return p
})

function stripShellQuotes(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ""
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2)
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

async function resolveStaticPathArg(arg: string, cwd: string) {
  const cleaned = stripShellQuotes(arg)
  if (!cleaned || DYNAMIC_PATH_PATTERN.test(cleaned)) return undefined

  const absolute = path.resolve(cwd, cleaned)
  const real = await fs.realpath(absolute).catch(() => absolute)
  return process.platform === "win32" ? Filesystem.windowsPath(real).replace(/\//g, "\\") : real
}

function sanitizeChildEnv(base: NodeJS.ProcessEnv, override: Record<string, string>) {
  const env: NodeJS.ProcessEnv = {
    ...base,
    ...override,
  }
  for (const key of FORBIDDEN_ENV_KEYS) {
    delete env[key]
  }
  return env
}

// TODO: we may wanna rename this tool so it works better on other shells
export const BashTool = Tool.define("bash", async () => {
  const shell = Shell.acceptable()
  log.info("bash tool using shell", { shell })

  return {
    description: DESCRIPTION.replaceAll("${directory}", Instance.directory)
      .replaceAll("${shell}", shell)
      .replaceAll("${maxLines}", String(Truncate.MAX_LINES))
      .replaceAll("${maxBytes}", String(Truncate.MAX_BYTES))
      .replaceAll("${defaultTimeout}", String(DEFAULT_TIMEOUT)),
    parameters: z.object({
      command: z.string().describe("The command to execute"),
      timeout: z.number().describe("Optional timeout in milliseconds").optional(),
      workdir: z
        .string()
        .describe(
          `The working directory to run the command in. Defaults to ${Instance.directory}. Use this instead of 'cd' commands.`,
        )
        .optional(),
      description: z
        .string()
        .describe(
          "Clear, concise description of what this command does in 5-10 words. Examples:\nInput: ls\nOutput: Lists files in current directory\n\nInput: git status\nOutput: Shows working tree status\n\nInput: npm install\nOutput: Installs package dependencies\n\nInput: mkdir foo\nOutput: Creates directory 'foo'",
        ),
      background: z
        .boolean()
        .describe(
          "When true, the command keeps running after this tool call returns until explicitly stopped or until the timeout lease expires. The tool returns immediately with the spawned PID once stdout/stderr are observed (or after a short readiness window). Use ONLY for long-lived servers (dev/preview/serve) that must outlive a single tool call so delivery checks can probe them. You are responsible for stopping it later (e.g. `kill <pid>` or `lsof -ti :<port> | xargs kill`).",
        )
        .optional(),
    }),
    async execute(params, ctx) {
      const cwd = params.workdir || Instance.directory
      if (params.timeout !== undefined && params.timeout < 0) {
        throw new Error(`Invalid timeout value: ${params.timeout}. Timeout must be a positive number.`)
      }
      const timeout = params.timeout ?? DEFAULT_TIMEOUT
      // Block commands that kill processes by name — these can destroy the host
      // process, benchmark, or sibling executors. Worktree isolation only covers
      // the filesystem; the process namespace is shared.
      if (isHostKillingCommand(params.command)) {
        return {
          title: "Refused",
          output: `Refused: this command kills processes by name and would destroy the host process. Use process-specific alternatives (e.g. kill a PID you spawned, or stop a service you started).`,
          metadata: { refused: true as boolean, command: params.command, output: "", exit: null as number | null, pid: null as number | null, background: false, description: params.description },
        }
      }

      const directories = new Set<string>()
      if (!Instance.containsPath(cwd)) directories.add(cwd)
      const patterns = new Set<string>()
      const always = new Set<string>()

      const tree = await parser().then((p) => p.parse(params.command))
      if (!tree) {
        throw new Error("Failed to parse command")
      }
      try {
        for (const node of tree.rootNode.descendantsOfType("command")) {
          if (!node) continue

          // Get full command text including redirects if present
          let commandText = node.parent?.type === "redirected_statement" ? node.parent.text : node.text

          const command: string[] = []
          for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i)
            if (!child) continue
            if (
              child.type !== "command_name" &&
              child.type !== "word" &&
              child.type !== "string" &&
              child.type !== "raw_string" &&
              child.type !== "concatenation"
            ) {
              continue
            }
            command.push(child.text)
          }

          // not an exhaustive list, but covers most common cases
          if (["cd", "rm", "cp", "mv", "mkdir", "touch", "chmod", "chown", "cat"].includes(command[0])) {
            for (const arg of command.slice(1)) {
              if (arg.startsWith("-") || (command[0] === "chmod" && arg.startsWith("+"))) continue
              const resolved = await resolveStaticPathArg(arg, cwd)
              log.info("resolved path", { arg, resolved })
              if (resolved) {
                if (!Instance.containsPath(resolved)) {
                  const dir = (await Filesystem.isDir(resolved)) ? resolved : path.dirname(resolved)
                  directories.add(dir)
                }
              }
            }
          }

          // cd covered by above check
          if (command.length && command[0] !== "cd") {
            patterns.add(commandText)
            always.add(BashArity.prefix(command).join(" ") + " *")
          }
        }
      } finally {
        disposeSyntaxTree(tree)
      }

      if (directories.size > 0) {
        const globs = Array.from(directories).map((dir) => {
          // Preserve POSIX-looking paths with /s, even on Windows
          if (dir.startsWith("/")) return `${dir.replace(/[\\/]+$/, "")}/*`
          return path.join(dir, "*")
        })
        await ctx.ask({
          permission: "external_directory",
          patterns: globs,
          always: globs,
          metadata: {},
        })
      }

      if (patterns.size > 0) {
        await ctx.ask({
          permission: "bash",
          patterns: Array.from(patterns),
          always: Array.from(always),
          metadata: {},
        })
      }

      const shellEnv = await Plugin.trigger(
        "shell.env",
        { cwd, sessionID: ctx.sessionID, callID: ctx.callID },
        { env: {} },
      )
      const guardEnv = await PidGuard.env(shell)
      const proc = spawn(params.command, {
        shell,
        cwd,
        env: sanitizeChildEnv(process.env, {
          ...shellEnv.env,
          ...gitCeilingEnvForWorktree(cwd, { ...process.env, ...shellEnv.env }),
          ...guardEnv,
        }),
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
      })

      let output = ""

      // Initialize metadata with empty output
      ctx.metadata({
        metadata: {
          output: "",
          description: params.description,
        },
      })

      const append = (chunk: Buffer) => {
        output += chunk.toString()
        ctx.metadata({
          metadata: {
            // truncate the metadata to avoid GIANT blobs of data (has nothing to do w/ what agent can access)
            output: output.length > MAX_METADATA_LENGTH ? output.slice(0, MAX_METADATA_LENGTH) + "\n\n..." : output,
            description: params.description,
          },
        })
      }

      proc.stdout?.on("data", append)
      proc.stderr?.on("data", append)

      let timedOut = false
      let aborted = false
      let exited = false

      const kill = () => Shell.killTree(proc, { exited: () => exited })

      if (ctx.abort.aborted) {
        aborted = true
        await kill()
      }

      if (params.background) {
        let backgroundLeaseTimer: ReturnType<typeof setTimeout> | undefined
        const markExited = () => {
          exited = true
        }
        proc.once("exit", () => {
          markExited()
        })
        proc.once("error", () => {
          markExited()
        })
        backgroundLeaseTimer = setTimeout(() => {
          timedOut = true
          void Shell.killTree(proc, { exited: () => exited, allowExitedRoot: true })
        }, timeout)
        backgroundLeaseTimer.unref?.()
        proc.unref?.()
        const readinessMs = Math.min(timeout, BASH_BACKGROUND_READINESS_MAX_MS)
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, readinessMs)
          proc.once("exit", () => {
            clearTimeout(timer)
            resolve()
          })
        })
        const resultMetadata: string[] = [
          `bash tool returned while command continues running in background (pid=${proc.pid ?? "unknown"})`,
          `background process lease timeout: ${timeout} ms`,
          `OpenCorvus will terminate this process tree when the lease expires unless you stop it first`,
          `stop it later with: kill ${proc.pid ?? "<pid>"} (or kill by port)`,
        ]
        if (timedOut) resultMetadata.push(`background process exceeded lease before readiness window`)
        if (exited) resultMetadata.push(`background process exited before readiness window (exit=${proc.exitCode})`)
        output += "\n\n<bash_metadata>\n" + resultMetadata.join("\n") + "\n</bash_metadata>"
        return {
          title: params.description,
          metadata: {
            refused: false as boolean,
            command: params.command,
            output: output.length > MAX_METADATA_LENGTH ? output.slice(0, MAX_METADATA_LENGTH) + "\n\n..." : output,
            exit: exited ? proc.exitCode : null,
            pid: proc.pid ?? null,
            background: true,
            description: params.description,
          },
          output,
        }
      }

      const abortHandler = () => {
        aborted = true
        void kill()
      }

      ctx.abort.addEventListener("abort", abortHandler, { once: true })

      const timeoutTimer = setTimeout(() => {
        timedOut = true
        void kill()
      }, timeout + 100)

      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timeoutTimer)
          ctx.abort.removeEventListener("abort", abortHandler)
        }

        proc.once("exit", () => {
          exited = true
          cleanup()
          resolve()
        })

        proc.once("error", (error) => {
          exited = true
          cleanup()
          reject(error)
        })
      })

      await Shell.killTree(proc, { exited: () => exited, allowExitedRoot: true })

      const resultMetadata: string[] = []

      if (timedOut) {
        resultMetadata.push(`bash tool terminated command after exceeding timeout ${timeout} ms`)
      }

      if (aborted) {
        resultMetadata.push("User aborted the command")
      }

      if (resultMetadata.length > 0) {
        output += "\n\n<bash_metadata>\n" + resultMetadata.join("\n") + "\n</bash_metadata>"
      }

      return {
        title: params.description,
        metadata: {
          refused: false as boolean,
          command: params.command,
          output: output.length > MAX_METADATA_LENGTH ? output.slice(0, MAX_METADATA_LENGTH) + "\n\n..." : output,
          exit: proc.exitCode,
          pid: null as number | null,
          background: false,
          description: params.description,
        },
        output,
      }
    },
  }
})

export function disposeSyntaxTree(tree: unknown): void {
  const disposable = tree as { delete?: () => void }
  disposable.delete?.()
}
