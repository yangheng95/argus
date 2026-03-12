import os from "os"
import path from "path"
import fs from "fs"
import { Process } from "@/util/process"
import type { ExecutorNameInfo } from "./compat"
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
  return [
    path.join(home, ".local", "bin"),
    path.join(home, "bin"),
    "/usr/local/bin",
    "/opt/homebrew/bin",
    "/usr/bin",
  ]
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
  for (const root of searchRoots()) {
    for (const name of names) {
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
  // Command may not exist on this system — missing tool is handled by the undefined check below
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
  const envResolved = envPath && exists(envPath)
    ? {
        path: envPath,
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
  const cmd = [resolved]
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
    const [opencode, codex, claude] = await Promise.all([
      locate({
        name: "opencode",
        env: "OPENCORVUS_EXECUTOR_OPENCODE_BIN",
        names: process.platform === "win32" ? ["opencode.exe", "opencode.cmd", "opencode"] : ["opencode"],
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
        names: process.platform === "win32" ? ["claude.exe", "claude-code.exe", "claude"] : ["claude", "claude-code"],
      }),
    ])

    return {
      opencode,
      codex,
      "claude-code": claude,
    }
  }
}
