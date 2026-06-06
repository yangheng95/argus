import { persistBrowserPreviewTarget, type PersistedBrowserPreviewTarget } from "./persist"
import { normalizeBrowserPreviewUrl } from "./target"
import { Log } from "@/util/log"

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"])
const HTTP_URL_TOKEN = /https?:\/\/[^\s<>"'`]+/gi
const ANSI_ESCAPE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g
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
}): Promise<PersistedBrowserPreviewTarget | undefined> {
  const taskID = input.taskID?.trim()
  if (!taskID) return Promise.resolve(undefined)
  const url = extractBrowserPreviewUrlFromText(input.output)
  if (!url) return Promise.resolve(undefined)
  return persistBrowserPreviewTarget({ taskID, url }).catch((error) => {
    log.warn("failed to persist browser preview target from process output", { taskID, url, error })
    return undefined
  })
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
