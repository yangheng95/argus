import path from "node:path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export type FrontendPreviewSource = "port_probe"

export type FrontendPreviewResolution = {
  url: string | null
  source: FrontendPreviewSource | null
  port: number | null
  checkedPorts: number[]
  reason?: string
}

export const DEFAULT_FRONTEND_PREVIEW_PORTS = [
  5173,
  4173,
  3000,
  3001,
  4321,
  8080,
  8000,
  5000,
] as const

export type ListeningProcess = {
  port: number
  pid?: number
  commandLine?: string
  executablePath?: string
  cwd?: string
}

export type ResolveFrontendPreviewInput = {
  directory: string
  configuredPorts?: readonly number[]
  queryPorts?: string
  excludePorts?: number[]
  requireOwnedProcess?: boolean
}

export function parsePreviewPorts(raw: string | undefined): number[] | undefined {
  if (!raw?.trim()) return undefined
  const ports = raw
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((port) => Number.isInteger(port) && port > 0 && port <= 65_535)
  return [...new Set(ports)].slice(0, 64)
}

export function configuredPreviewPorts(input: {
  configuredPorts?: readonly number[]
  queryPorts?: string
}): number[] {
  const explicit = parsePreviewPorts(input.queryPorts)
  const configured = input.configuredPorts?.filter((port) =>
    Number.isInteger(port) && port > 0 && port <= 65_535
  )
  const source = explicit?.length
    ? explicit
    : configured?.length
      ? configured
      : [...DEFAULT_FRONTEND_PREVIEW_PORTS]
  return [...new Set(source)].slice(0, 64)
}

export async function resolveFrontendPreview(
  input: ResolveFrontendPreviewInput,
): Promise<FrontendPreviewResolution> {
  const ports = configuredPreviewPorts({
    configuredPorts: input.configuredPorts,
    queryPorts: input.queryPorts,
  })
  const exclude = new Set((input.excludePorts ?? []).filter((port) => port > 0))
  const checkedPorts = ports.filter((port) => !exclude.has(port))
  if (checkedPorts.length === 0) {
    return {
      url: null,
      source: null,
      port: null,
      checkedPorts,
      reason: "no_preview_ports",
    }
  }

  const owners = input.requireOwnedProcess === false
    ? new Map<number, ListeningProcess>()
    : await listeningProcessesForPorts(checkedPorts)
  for (const port of checkedPorts) {
    const owner = owners.get(port)
    if (input.requireOwnedProcess !== false && !processBelongsToDirectory(owner, input.directory)) {
      continue
    }
    const url = `http://127.0.0.1:${port}/`
    if (await probeFrontendDocument(url)) {
      return {
        url,
        source: "port_probe",
        port,
        checkedPorts,
      }
    }
  }
  return {
    url: null,
    source: null,
    port: null,
    checkedPorts,
    reason: input.requireOwnedProcess === false ? "no_html_document" : "no_owned_frontend_document",
  }
}

export async function probeFrontendDocument(url: string): Promise<boolean> {
  if (!isLoopbackHttpUrl(url)) return false
  const response = await fetch(url, {
    signal: AbortSignal.timeout(900),
    redirect: "follow",
  }).catch(() => undefined)
  if (!response || response.status < 200 || response.status >= 400) return false
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? ""
  if (!contentType.includes("text/html")) return false
  const body = await response.text().catch(() => "")
  return isDocumentLikeHtml(body)
}

export function isLoopbackHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    if (url.protocol !== "http:" && url.protocol !== "https:") return false
    return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]" || url.hostname === "::1"
  } catch {
    return false
  }
}

export function isDocumentLikeHtml(body: string): boolean {
  const sample = body.slice(0, 16_384).toLowerCase()
  return sample.includes("<!doctype html") || sample.includes("<html") || sample.includes("<body")
}

export function processBelongsToDirectory(
  proc: ListeningProcess | undefined,
  directory: string,
): boolean {
  if (!proc) return false
  const root = path.resolve(directory)
  if (proc.cwd && pathIsInside(proc.cwd, root)) return true
  const haystack = normalizePathText([
    proc.commandLine,
    proc.executablePath,
  ].filter((item): item is string => Boolean(item)).join("\n"))
  return haystack.includes(normalizePathText(root))
}

function pathIsInside(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate))
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative))
}

function normalizePathText(value: string): string {
  return value.replaceAll("\\", "/").toLowerCase()
}

async function listeningProcessesForPorts(ports: number[]): Promise<Map<number, ListeningProcess>> {
  if (process.platform === "win32") return windowsListeningProcessesForPorts(ports)
  return posixListeningProcessesForPorts(ports)
}

async function windowsListeningProcessesForPorts(ports: number[]): Promise<Map<number, ListeningProcess>> {
  const portList = ports.join(",")
  const script = `
$ports = @(${portList})
$connections = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
  Where-Object { $ports -contains [int]$_.LocalPort } |
  Select-Object LocalPort, OwningProcess
$items = foreach ($connection in $connections) {
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($connection.OwningProcess)" -ErrorAction SilentlyContinue
  [PSCustomObject]@{
    port = [int]$connection.LocalPort
    pid = [int]$connection.OwningProcess
    commandLine = if ($process) { [string]$process.CommandLine } else { "" }
    executablePath = if ($process) { [string]$process.ExecutablePath } else { "" }
  }
}
$items | ConvertTo-Json -Compress
`
  const { stdout } = await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    script,
  ], { timeout: 3_000, windowsHide: true }).catch(() => ({ stdout: "" }))
  return parseListeningProcessJson(stdout)
}

async function posixListeningProcessesForPorts(ports: number[]): Promise<Map<number, ListeningProcess>> {
  const { stdout } = await execFileAsync("lsof", [
    "-nP",
    "-iTCP",
    "-sTCP:LISTEN",
  ], { timeout: 3_000 }).catch(() => ({ stdout: "" }))
  const wanted = new Set(ports)
  const result = new Map<number, ListeningProcess>()
  for (const line of stdout.split(/\r?\n/).slice(1)) {
    const parts = line.trim().split(/\s+/)
    const pid = Number(parts[1])
    const name = parts.at(-2) ?? ""
    const match = name.match(/:(\d+)(?:\s|\(|$)/)
    const port = match ? Number(match[1]) : Number.NaN
    if (!wanted.has(port)) continue
    result.set(port, { port, pid, commandLine: parts.join(" ") })
  }
  return result
}

function parseListeningProcessJson(raw: string): Map<number, ListeningProcess> {
  const result = new Map<number, ListeningProcess>()
  if (!raw.trim()) return result
  let parsed: ListeningProcess | ListeningProcess[]
  try {
    parsed = JSON.parse(raw) as ListeningProcess | ListeningProcess[]
  } catch {
    return result
  }
  const rows = Array.isArray(parsed) ? parsed : [parsed]
  for (const row of rows) {
    const port = Number(row.port)
    if (!Number.isInteger(port) || port <= 0 || port > 65_535) continue
    result.set(port, {
      port,
      pid: row.pid === undefined ? undefined : Number(row.pid),
      commandLine: typeof row.commandLine === "string" ? row.commandLine : undefined,
      executablePath: typeof row.executablePath === "string" ? row.executablePath : undefined,
      cwd: typeof row.cwd === "string" ? row.cwd : undefined,
    })
  }
  return result
}
