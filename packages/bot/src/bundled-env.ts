import { mkdir } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const BUNDLE_FILE_ENV = "OPENCORVUS_BOT_BUNDLED_ENV_FILE"
const STATE_FILE_ENV = "OPENCORVUS_BOT_BUNDLED_STATE_FILE"
const TTL_HOURS_ENV = "OPENCORVUS_BOT_BUNDLED_TTL_HOURS"
const DEFAULT_BUNDLE_FILE = ".env.bundle"
const DEFAULT_TTL_HOURS = 24
const STATE_FILE_NAME = "bundled-env-state.json"

type State = {
  first_used_at: number
}

export type BundledEnvResult = {
  enabled: boolean
  expired: boolean
  applied: number
  skipped: number
  file: string
  stateFile: string
  firstUsedAt?: string
  expireAt?: string
  reason?: "missing_bundle" | "empty_bundle" | "expired" | "invalid_bundle"
}

function ttlMs() {
  const hours = Number(process.env[TTL_HOURS_ENV] ?? DEFAULT_TTL_HOURS)
  if (!Number.isFinite(hours) || hours <= 0) return DEFAULT_TTL_HOURS * 60 * 60 * 1000
  return hours * 60 * 60 * 1000
}

function resolve(input: string) {
  if (path.isAbsolute(input)) return input
  return path.resolve(process.cwd(), input)
}

function bundleFile() {
  return resolve(process.env[BUNDLE_FILE_ENV] ?? DEFAULT_BUNDLE_FILE)
}

function stateDir() {
  const home = os.homedir()
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local")
    return path.join(base, "opencorvus", "bot")
  }
  if (process.env.XDG_STATE_HOME) {
    return path.join(process.env.XDG_STATE_HOME, "opencorvus", "bot")
  }
  return path.join(home, ".local", "state", "opencorvus", "bot")
}

function stateFile() {
  const input = process.env[STATE_FILE_ENV]
  if (input) return resolve(input)
  return path.join(stateDir(), STATE_FILE_NAME)
}

function parseValue(input: string) {
  const value = input.trim()
  if (value.length < 2) return value
  const head = value[0]
  const tail = value[value.length - 1]
  if ((head === '"' && tail === '"') || (head === "'" && tail === "'")) {
    return value.slice(1, value.length - 1)
  }
  return value
}

function parseBundle(raw: string) {
  const env: Record<string, string> = {}
  for (const line of raw.split(/\r?\n/)) {
    const text = line.trim()
    if (!text || text.startsWith("#")) continue
    const body = text.startsWith("export ") ? text.slice(7).trim() : text
    const idx = body.indexOf("=")
    if (idx <= 0) continue
    const key = body.slice(0, idx).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue
    env[key] = parseValue(body.slice(idx + 1))
  }
  return env
}

async function readState(file: string) {
  const handle = Bun.file(file)
  if (!(await handle.exists())) return
  try {
    const data = await handle.json()
    const val = (data as Partial<State>).first_used_at
    if (typeof val !== "number" || !Number.isFinite(val) || val <= 0) return
    return { first_used_at: val }
  } catch {
    return
  }
}

async function writeState(file: string, firstUsedAt: number) {
  await mkdir(path.dirname(file), { recursive: true })
  await Bun.write(file, JSON.stringify({ first_used_at: firstUsedAt } satisfies State))
}

export async function applyBundledEnv(now = Date.now()): Promise<BundledEnvResult> {
  const file = bundleFile()
  const state = stateFile()
  const handle = Bun.file(file)
  if (!(await handle.exists())) {
    return {
      enabled: false,
      expired: false,
      applied: 0,
      skipped: 0,
      file,
      stateFile: state,
      reason: "missing_bundle",
    }
  }

  const raw = await handle.text()
  const env = parseBundle(raw)
  const entries = Object.entries(env)
  if (entries.length === 0) {
    return {
      enabled: false,
      expired: false,
      applied: 0,
      skipped: 0,
      file,
      stateFile: state,
      reason: raw.trim() ? "invalid_bundle" : "empty_bundle",
    }
  }

  const cur = await readState(state)
  const firstUsedAt = cur?.first_used_at ?? now
  if (!cur) {
    await writeState(state, firstUsedAt)
  }

  const expireAtMs = firstUsedAt + ttlMs()
  const expired = now > expireAtMs
  if (expired) {
    return {
      enabled: false,
      expired: true,
      applied: 0,
      skipped: entries.length,
      file,
      stateFile: state,
      firstUsedAt: new Date(firstUsedAt).toISOString(),
      expireAt: new Date(expireAtMs).toISOString(),
      reason: "expired",
    }
  }

  let applied = 0
  let skipped = 0
  for (const [key, value] of entries) {
    if (process.env[key] !== undefined) {
      skipped += 1
      continue
    }
    process.env[key] = value
    applied += 1
  }

  return {
    enabled: true,
    expired: false,
    applied,
    skipped,
    file,
    stateFile: state,
    firstUsedAt: new Date(firstUsedAt).toISOString(),
    expireAt: new Date(expireAtMs).toISOString(),
  }
}
