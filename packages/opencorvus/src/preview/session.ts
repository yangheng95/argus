import fs from "node:fs/promises"
import path from "node:path"
import { spawn, type ChildProcess } from "node:child_process"
import { isLoopbackHttpUrl, probeFrontendDocument } from "./frontend"

const PREVIEW_START_IDLE_TIMEOUT_MS = 30_000
const PREVIEW_READY_TIMEOUT_MS = 15_000

export type ManagedPreviewSessionStatus = "starting" | "ready" | "failed" | "stopped"

export type ManagedPreviewSession = {
  key: string
  taskID: string
  workspaceDir: string
  command: string
  status: ManagedPreviewSessionStatus
  url?: string
  reason?: string
  evidence: string[]
  startedAt: number
  updatedAt: number
}

type LiveManagedPreviewSession = ManagedPreviewSession & {
  child?: ChildProcess
  ready?: Promise<ManagedPreviewSession>
}

const sessions = new Map<string, LiveManagedPreviewSession>()

export async function ensureManagedPreviewSession(input: {
  taskID?: string
  workspaceDir: string
  metadata?: Record<string, unknown>
}): Promise<ManagedPreviewSession> {
  const explicitPreviewUrl = previewUrlFromMetadata(input.metadata)
  const taskID = input.taskID?.trim() || "no-task"
  const workspaceDir = path.resolve(input.workspaceDir)
  const key = sessionKey({ taskID, workspaceDir })
  if (explicitPreviewUrl) {
    const now = Date.now()
    const session: LiveManagedPreviewSession = {
      key,
      taskID,
      workspaceDir,
      command: "metadata.previewUrl",
      status: "ready",
      url: explicitPreviewUrl,
      evidence: [`preview_url=${explicitPreviewUrl}`, "preview_source=metadata"],
      startedAt: now,
      updatedAt: now,
    }
    sessions.set(key, session)
    return sessionView(session)!
  }

  const existing = sessions.get(key)
  if (existing?.status === "ready" && existing.url) {
    return sessionView(existing)!
  }
  if (existing?.status === "starting" && existing.ready) {
    return sessionView(await existing.ready)!
  }
  if (existing) {
    await stopLiveSession(existing)
    sessions.delete(key)
  }

  const pkg = await readRuntimePackage(workspaceDir)
  if (!pkg.scripts?.dev) {
    throw new Error(`no_preview_start_script: ${workspaceDir} package.json must define scripts.dev for frontend runtime evaluation`)
  }
  const manager = packageManagerName(pkg)
  if (!manager) {
    throw new Error(`no_package_manager: ${workspaceDir} package.json must define packageManager for frontend runtime evaluation`)
  }

  const command = `${manager} run dev`
  const child = spawn(manager, ["run", "dev"], {
    cwd: workspaceDir,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  })
  const now = Date.now()
  const session: LiveManagedPreviewSession = {
    key,
    taskID,
    workspaceDir,
    command,
    status: "starting",
    child,
    evidence: [`managed_preview_command=${command}`],
    startedAt: now,
    updatedAt: now,
  }
  session.ready = waitForManagedPreviewUrl(child)
    .then((url) => {
      session.status = "ready"
      session.url = url
      session.updatedAt = Date.now()
      session.evidence = [...session.evidence, `preview_url=${url}`]
      return session
    })
    .catch(async (error) => {
      session.status = "failed"
      session.reason = error instanceof Error ? error.message : String(error)
      session.updatedAt = Date.now()
      await stopLiveSession(session, { markStopped: false })
      throw error
    })
  sessions.set(key, session)
  return sessionView(await session.ready)!
}

export function getManagedPreviewSession(input: {
  taskID?: string
  workspaceDir: string
}): ManagedPreviewSession | undefined {
  return sessionView(sessions.get(sessionKey({
    taskID: input.taskID?.trim() || "no-task",
    workspaceDir: path.resolve(input.workspaceDir),
  })))
}

export async function stopManagedPreviewSession(input: {
  taskID?: string
  workspaceDir: string
}): Promise<void> {
  const key = sessionKey({
    taskID: input.taskID?.trim() || "no-task",
    workspaceDir: path.resolve(input.workspaceDir),
  })
  const session = sessions.get(key)
  if (!session) return
  await stopLiveSession(session)
  sessions.delete(key)
}

export async function stopAllManagedPreviewSessions(): Promise<void> {
  const values = [...sessions.values()]
  sessions.clear()
  await Promise.all(values.map((session) => stopLiveSession(session)))
}

function previewUrlFromMetadata(metadata: Record<string, unknown> | undefined): string | undefined {
  const raw = metadata?.previewUrl ?? metadata?.frontendPreviewUrl
  if (typeof raw !== "string") return undefined
  const trimmed = raw.trim()
  return isLoopbackHttpUrl(trimmed) ? trimmed : undefined
}

function sessionKey(input: { taskID: string; workspaceDir: string }) {
  const resolved = path.resolve(input.workspaceDir)
  const workspaceKey = process.platform === "win32" ? resolved.toLowerCase() : resolved
  return `${input.taskID}:${workspaceKey}`
}

async function waitForManagedPreviewUrl(child: ChildProcess): Promise<string> {
  let output = ""
  let candidateUrl: string | undefined
  let candidateSeenAt = 0
  let lastOutputAt = Date.now()
  child.stdout?.on("data", (chunk) => {
    lastOutputAt = Date.now()
    output += Buffer.from(chunk).toString("utf8")
    candidateUrl = candidateUrl ?? firstLoopbackUrl(output)
    if (candidateUrl && candidateSeenAt === 0) candidateSeenAt = Date.now()
  })
  child.stderr?.on("data", (chunk) => {
    lastOutputAt = Date.now()
    output += Buffer.from(chunk).toString("utf8")
    candidateUrl = candidateUrl ?? firstLoopbackUrl(output)
    if (candidateUrl && candidateSeenAt === 0) candidateSeenAt = Date.now()
  })

  let exited: { code: number | null; signal: NodeJS.Signals | null } | undefined
  child.once("exit", (code, signal) => {
    exited = { code, signal }
  })

  while (true) {
    if (candidateUrl) {
      if (await probeFrontendDocument(candidateUrl)) return candidateUrl
      if (Date.now() - candidateSeenAt > PREVIEW_READY_TIMEOUT_MS) {
        throw new Error(`preview_not_ready: ${candidateUrl} did not serve an HTML document before timeout`)
      }
    }
    if (exited) {
      throw new Error(`preview_process_exited: code=${exited.code ?? "null"} signal=${exited.signal ?? "null"}`)
    }
    if (!candidateUrl && Date.now() - lastOutputAt > PREVIEW_START_IDLE_TIMEOUT_MS) {
      throw new Error("preview_start_idle_timeout: dev script did not print a loopback preview URL")
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

function firstLoopbackUrl(output: string): string | undefined {
  const matches = output.match(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|::1):\d+\/?/g) ?? []
  return matches.find((url) => isLoopbackHttpUrl(url))
}

async function stopLiveSession(
  session: LiveManagedPreviewSession,
  options: { markStopped?: boolean } = {},
): Promise<void> {
  if (options.markStopped !== false) {
    session.status = "stopped"
    session.updatedAt = Date.now()
  }
  const child = session.child
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === "win32" && child.pid) {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: ["ignore", "ignore", "ignore"],
      })
      killer.once("exit", () => resolve())
      killer.once("error", () => resolve())
    })
    return
  }
  child.kill()
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 2_000)
    child.once("exit", () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

async function readRuntimePackage(projectDir: string): Promise<{
  scripts?: Record<string, string>
  packageManager?: string
}> {
  const raw = await fs.readFile(path.join(projectDir, "package.json"), "utf8")
  return JSON.parse(raw) as { scripts?: Record<string, string>; packageManager?: string }
}

function packageManagerName(pkg: { packageManager?: string }) {
  const raw = pkg.packageManager?.trim()
  if (!raw) return undefined
  const manager = raw.split("@", 1)[0]
  return /^[a-z0-9._-]+$/i.test(manager) ? manager : undefined
}

function sessionView(session: LiveManagedPreviewSession | undefined): ManagedPreviewSession | undefined {
  if (!session) return undefined
  return {
    key: session.key,
    taskID: session.taskID,
    workspaceDir: session.workspaceDir,
    command: session.command,
    status: session.status,
    url: session.url,
    reason: session.reason,
    evidence: [...session.evidence],
    startedAt: session.startedAt,
    updatedAt: session.updatedAt,
  }
}
