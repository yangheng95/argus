import { persistBrowserPreviewTarget, type PersistedBrowserPreviewTarget } from "./persist"
import { normalizeBrowserPreviewUrl } from "./target"
import { Log } from "@/util/log"

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"])
const HTTP_URL_TOKEN = /https?:\/\/[^\s<>"'`]+/gi
const ANSI_ESCAPE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g
const PREVIEW_TARGET_REACHABILITY_TIMEOUT_MS = 5_000
const PREVIEW_TARGET_REACHABILITY_INTERVAL_MS = 250
const PREVIEW_TARGET_REACHABILITY_REQUEST_TIMEOUT_MS = 1_000
const log = Log.create({ service: "browser-preview-extract" })

export function extractBrowserPreviewUrlFromText(text: string): string | undefined {
  const clean = text.replace(ANSI_ESCAPE, "")
  for (const match of clean.matchAll(HTTP_URL_TOKEN)) {
    const normalized = normalizeBrowserPreviewUrl(trimUrlToken(match[0]))
    if (!normalized) continue
    if (isLoopbackBrowserPreviewUrl(normalized)) return normalized
  }
  return undefined
}

export function persistBrowserPreviewTargetFromProcessOutput(input: {
  taskID?: string
  output: string
  probe?: (url: string) => Promise<boolean>
}): Promise<PersistedBrowserPreviewTarget | undefined> {
  const taskID = input.taskID?.trim()
  if (!taskID) return Promise.resolve(undefined)
  const url = extractBrowserPreviewUrlFromText(input.output)
  if (!url) return Promise.resolve(undefined)
  const probe = input.probe ?? waitForBrowserPreviewUrlReachable
  return probe(url)
    .then((reachable) => {
      if (!reachable) {
        log.warn("skipped unreachable browser preview target from process output", { taskID, url })
        return undefined
      }
      return persistBrowserPreviewTarget({ taskID, url })
    })
    .catch((error) => {
      log.warn("failed to persist browser preview target from process output", { taskID, url, error })
      return undefined
    })
}

export async function waitForBrowserPreviewUrlReachable(
  url: string,
  input: {
    timeoutMs?: number
    intervalMs?: number
    fetchImpl?: typeof fetch
  } = {},
): Promise<boolean> {
  const timeoutMs = input.timeoutMs ?? PREVIEW_TARGET_REACHABILITY_TIMEOUT_MS
  const intervalMs = input.intervalMs ?? PREVIEW_TARGET_REACHABILITY_INTERVAL_MS
  const fetchImpl = input.fetchImpl ?? fetch
  const deadline = Date.now() + timeoutMs
  while (Date.now() <= deadline) {
    if (await probeBrowserPreviewUrl(url, fetchImpl)) return true
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  return false
}

async function probeBrowserPreviewUrl(url: string, fetchImpl: typeof fetch): Promise<boolean> {
  const signal = AbortSignal.timeout(PREVIEW_TARGET_REACHABILITY_REQUEST_TIMEOUT_MS)
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      cache: "no-store",
      signal,
    })
    await response.body?.cancel().catch(() => undefined)
    return response.status >= 200 && response.status < 400
  } catch {
    return false
  }
}

function trimUrlToken(token: string): string {
  return token.replace(/[),.;\]}]+$/g, "")
}

function isLoopbackBrowserPreviewUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return LOOPBACK_HOSTS.has(url.hostname.toLowerCase())
  } catch {
    return false
  }
}
