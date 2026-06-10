import { persistBrowserPreviewTarget, type PersistedBrowserPreviewTarget } from "./persist"
import { normalizeBrowserPreviewUrl } from "./target"
import { isLoopbackBrowserPreviewUrl, waitForBrowserPreviewUrlReachable } from "./liveness"
import { deriveBrowserPreviewUrlsFromDevServerCommand } from "./dev-server-command"
import { Log } from "@/util/log"

const LOCAL_URL_TOKEN =
  /(?:^|[\s(<"'=])((?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):\d{1,5}(?:\/[^\s<>"'`]*)?)/gi
const ANSI_ESCAPE = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g
const MAX_PREVIEW_OUTPUT_SCAN_CHARS = 65_536
const MAX_EXTRACTED_PREVIEW_URLS = 16
const log = Log.create({ service: "browser-preview-extract" })

export function extractBrowserPreviewUrlFromText(text: string): string | undefined {
  return extractBrowserPreviewUrlsFromText(text)[0]
}

export function extractBrowserPreviewUrlsFromText(text: string): string[] {
  const clean = text.replace(ANSI_ESCAPE, "")
  const scan = clean.length > MAX_PREVIEW_OUTPUT_SCAN_CHARS ? clean.slice(-MAX_PREVIEW_OUTPUT_SCAN_CHARS) : clean
  const urls: string[] = []
  const seen = new Set<string>()
  for (const match of scan.matchAll(LOCAL_URL_TOKEN)) {
    const normalized = normalizeBrowserPreviewUrl(trimUrlToken(match[1]))
    if (!normalized) continue
    if (!isLoopbackBrowserPreviewUrl(normalized)) continue
    const key = normalized.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    urls.push(normalized)
    if (urls.length >= MAX_EXTRACTED_PREVIEW_URLS) break
  }
  return urls
}

export function persistBrowserPreviewTargetFromProcessOutput(input: {
  taskID?: string
  output: string
  probe?: (url: string) => Promise<boolean>
}): Promise<PersistedBrowserPreviewTarget[]> {
  const taskID = input.taskID?.trim()
  if (!taskID) return Promise.resolve([])
  const urls = extractBrowserPreviewUrlsFromText(input.output)
  if (urls.length === 0) return Promise.resolve([])
  return persistBrowserPreviewUrls({ taskID, urls, probe: input.probe })
}

export function createBrowserPreviewProcessOutputMaterializer(input: {
  taskID?: string
  command?: string
  probe?: (url: string) => Promise<boolean>
}): {
  ingest(chunk: string): Promise<PersistedBrowserPreviewTarget[]>
  flush(): Promise<void>
} {
  const taskID = input.taskID?.trim()
  const persisted = new Set<string>()
  const commandUrls = input.command ? deriveBrowserPreviewUrlsFromDevServerCommand(input.command) : []
  let tail = ""
  let pending = Promise.resolve()
  const enqueue = (urls: string[]): Promise<PersistedBrowserPreviewTarget[]> => {
    if (!taskID || urls.length === 0) return Promise.resolve([])
    const next = pending.then(() => persistRetryableBrowserPreviewUrls({ taskID, urls, persisted, probe: input.probe }))
    pending = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }
  const ingest = (chunk: string): Promise<PersistedBrowserPreviewTarget[]> => {
    if (!taskID || !chunk) return Promise.resolve([])
    const scan = tail + chunk
    tail = scan.slice(-MAX_PREVIEW_OUTPUT_SCAN_CHARS)
    const urls = [...extractBrowserPreviewUrlsFromText(scan), ...commandUrls]
    if (urls.length === 0) return Promise.resolve([])
    return enqueue(urls)
  }
  return {
    ingest,
    flush: () => enqueue(commandUrls).then(() => pending),
  }
}

function persistRetryableBrowserPreviewUrls(input: {
  taskID: string
  urls: string[]
  persisted: Set<string>
  probe?: (url: string) => Promise<boolean>
}): Promise<PersistedBrowserPreviewTarget[]> {
  const urls: string[] = []
  const queued = new Set<string>()
  for (const url of input.urls) {
    const key = url.toLowerCase()
    if (input.persisted.has(key) || queued.has(key)) continue
    queued.add(key)
    urls.push(url)
  }
  if (urls.length === 0) return Promise.resolve([])
  return persistBrowserPreviewUrls({ taskID: input.taskID, urls, probe: input.probe }).then((targets) => {
    for (const target of targets) input.persisted.add(target.url.toLowerCase())
    return targets
  })
}

function persistBrowserPreviewUrls(input: {
  taskID: string
  urls: string[]
  probe?: (url: string) => Promise<boolean>
}): Promise<PersistedBrowserPreviewTarget[]> {
  const probe = input.probe ?? waitForBrowserPreviewUrlReachable
  return Promise.all(
    input.urls.map(async (url) => {
      try {
        if (!(await probe(url))) {
          log.warn("skipped unreachable browser preview target from process output", { taskID: input.taskID, url })
          return undefined
        }
        return persistBrowserPreviewTarget({ taskID: input.taskID, url })
      } catch (error) {
        log.warn("failed to persist browser preview target from process output", { taskID: input.taskID, url, error })
        return undefined
      }
    }),
  ).then((targets): PersistedBrowserPreviewTarget[] =>
    targets.filter((target): target is PersistedBrowserPreviewTarget => Boolean(target)),
  )
}

function trimUrlToken(token: string): string {
  return token.replace(/[),.;\]}]+$/g, "")
}
