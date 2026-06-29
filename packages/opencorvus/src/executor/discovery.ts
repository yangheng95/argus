import os from "os"
import path from "path"
import fs from "fs"
import { Process } from "@/util/process"
import type { ExecutorNameInfo } from "./contract"
import { normalizeExecutableArgv, unwrapCommandQuotes } from "@/util/command"
import { which } from "@/util/which"

type Found = {
  name: ExecutorNameInfo
  available: boolean
  source: "builtin" | "env" | "bundle" | "path" | "common" | "missing"
  command?: string[]
  path?: string
  version?: string
  detail: string
}

const common = () => {
  const home = os.homedir()
  if (process.platform === "win32") {
    return [
      path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "npm"),
      path.join(home, ".local", "bin"),
    ]
  }
  return [path.join(home, ".local", "bin"), path.join(home, "bin"), "/usr/local/bin", "/opt/homebrew/bin", "/usr/bin"]
}

function split(input: string | undefined) {
  if (!input) return []
  return input
    .split(/[;\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function searchRoots() {
  const execDir = path.dirname(process.execPath)
  return [
    ...split(process.env.OPENCORVUS_EXECUTOR_SEARCH_PATHS),
    path.resolve(execDir, "..", "tools"),
    path.join(execDir, "tools"),
    ...common(),
  ]
}

function exists(file: string) {
  try {
    return fs.existsSync(file)
  } catch {
    return false
  }
}

function findInRoots(names: string[]) {
  // name-major iteration: scan every root for the highest-priority name
  // before falling back to the next one. The previous root-major order
  // returned `claude.cmd` from %APPDATA%\npm before the spawnable
  // `claude.exe` in ~/.local/bin, defeating the .exe preference set by
  // callers — see CVE-2024-27980, child_process.spawn refuses .cmd
  // without shell:true and the Anthropic SDK spawns the executable with
  // `{ windowsHide: true }` and no shell, so a .cmd path crashes the
  // build attempt instantly.
  const roots = searchRoots()
  for (const name of names) {
    for (const root of roots) {
      const file = path.join(root, name)
      if (exists(file)) {
        return {
          path: file,
          source: root.includes("tools") ? ("bundle" as const) : ("common" as const),
        }
      }
    }
  }
}

function findOnPath(names: string[]) {
  for (const name of names) {
    const value = which(name)
    if (!value) continue
    return {
      path: value,
      source: "path" as const,
    }
  }
}

function currentTarget() {
  if (process.platform === "win32") {
    if (process.arch === "x64") return { triple: "x86_64-pc-windows-msvc", pkg: "@openai/codex-win32-x64" }
    if (process.arch === "arm64") return { triple: "aarch64-pc-windows-msvc", pkg: "@openai/codex-win32-arm64" }
  }
  if (process.platform === "darwin") {
    if (process.arch === "x64") return { triple: "x86_64-apple-darwin", pkg: "@openai/codex-darwin-x64" }
    if (process.arch === "arm64") return { triple: "aarch64-apple-darwin", pkg: "@openai/codex-darwin-arm64" }
  }
  if (process.platform === "linux") {
    if (process.arch === "x64") return { triple: "x86_64-unknown-linux-musl", pkg: "@openai/codex-linux-x64" }
    if (process.arch === "arm64") return { triple: "aarch64-unknown-linux-musl", pkg: "@openai/codex-linux-arm64" }
  }
}

function codexBinary(input: string) {
  const ext = path.extname(input).toLowerCase()
  if (![".cmd", ".ps1", ".js", ""].includes(ext) || process.platform !== "win32") {
    return input
  }
  const target = currentTarget()
  if (!target) return input
  const dir = path.dirname(input)
  const candidate = path.join(
    dir,
    "node_modules",
    target.pkg,
    "vendor",
    target.triple,
    "codex",
    process.platform === "win32" ? "codex.exe" : "codex",
  )
  if (exists(candidate)) return candidate
  const local = path.join(
    dir,
    "node_modules",
    "@openai",
    "codex",
    "vendor",
    target.triple,
    "codex",
    process.platform === "win32" ? "codex.exe" : "codex",
  )
  if (exists(local)) return local
  return input
}

async function version(command: string[]) {
  const result = await Process.run([...command, "--version"], {
    nothrow: true,
  }).catch(() => undefined)
  if (!result || result.code !== 0) return
  const text = result.stdout.toString("utf8").trim() || result.stderr.toString("utf8").trim()
  return text.split(/\r?\n/)[0]?.trim()
}

async function locate(input: {
  name: ExecutorNameInfo
  env: string
  names: string[]
  builtin?: boolean
  resolve?: (path: string) => string
}): Promise<Found> {
  if (input.builtin) {
    const external: Found = await locate({
      ...input,
      builtin: false,
    })
    return {
      name: input.name,
      available: true,
      source: "builtin" as const,
      path: external.path,
      command: external.command,
      version: external.version,
      detail: external.path ? `builtin (external also found at ${external.path})` : "builtin",
    } satisfies Found
  }

  const envPath = process.env[input.env]?.trim()
  const envExecutable = envPath ? unwrapCommandQuotes(envPath) : undefined
  const envResolved =
    envExecutable && exists(envExecutable)
      ? {
          path: envExecutable,
          source: "env" as const,
        }
      : undefined
  const rootFound = findInRoots(input.names)
  const pathFound = findOnPath(input.names)
  const next = envResolved ?? rootFound ?? pathFound
  if (!next) {
    return {
      name: input.name,
      available: false,
      source: "missing",
      detail: "not found",
    } satisfies Found
  }

  const resolved = input.resolve ? input.resolve(next.path) : next.path
  const cmd = normalizeExecutableArgv([resolved])
  return {
    name: input.name,
    available: true,
    source: next.source,
    path: resolved,
    command: cmd,
    version: await version(cmd),
    detail: resolved,
  } satisfies Found
}

export namespace ExecutorDiscovery {
  export async function scan() {
    const [opencorvus, codex, claude] = await Promise.all([
      locate({
        name: "opencorvus",
        env: "OPENCORVUS_EXECUTOR_OPENCORVUS_BIN",
        names: process.platform === "win32" ? ["opencorvus.exe", "opencorvus.cmd", "opencorvus"] : ["opencorvus"],
        builtin: true,
      }),
      locate({
        name: "codex",
        env: "OPENCORVUS_EXECUTOR_CODEX_BIN",
        names: process.platform === "win32" ? ["codex.exe", "codex.cmd", "codex"] : ["codex"],
        resolve: codexBinary,
      }),
      locate({
        name: "claude-code",
        env: "OPENCORVUS_EXECUTOR_CLAUDE_CODE_BIN",
        // Windows: prefer the real `.exe` over the npm `.cmd` shim. Since
        // CVE-2024-27980 (Node 18.20.2 / 20.12.2 / 21.7.3) child_process.spawn
        // refuses to launch `.cmd` / `.bat` files unless `shell: true` is set,
        // and the Anthropic Claude Agent SDK spawns the executable with
        // `{ windowsHide: true }` and no shell — so a .cmd path exits 1
        // immediately. Real .exe shims (e.g. claude.exe in ~/.local/bin or a
        // shim emitted by yarn/pnpm) are spawnable directly. Fall back to
        // .cmd only when no .exe is on the search path; users who land on it
        // will see the documented error and can install the .exe variant.
        names:
          process.platform === "win32"
            ? ["claude.exe", "claude-code.exe", "claude.cmd", "claude-code.cmd", "claude"]
            : ["claude", "claude-code"],
      }),
    ])

    return {
      opencorvus,
      codex,
      "claude-code": claude,
    }
  }
}
