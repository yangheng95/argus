import { persistBrowserPreviewTarget, type PersistedBrowserPreviewTarget } from "./persist"
import { normalizeBrowserPreviewUrl } from "./target"
import { isLoopbackBrowserPreviewUrl, waitForBrowserPreviewUrlReachable } from "./liveness"
import { Log } from "@/util/log"
import type { BrowserPreviewViewport } from "./viewport"

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

export function persistBrowserPreviewUrls(input: {
  taskID: string
  urls: string[]
  viewports: readonly BrowserPreviewViewport[]
  probe?: (url: string) => Promise<boolean>
}): Promise<PersistedBrowserPreviewTarget[]> {
  const probe = input.probe ?? waitForBrowserPreviewUrlReachable
  const seen = new Set<string>()
  const urls = input.urls.filter((url) => {
    const key = url.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return Promise.all(
    urls.map(async (url) => {
      try {
        if (!(await probe(url))) {
          log.warn("skipped unreachable browser preview target from process output", { taskID: input.taskID, url })
          return undefined
        }
        return persistBrowserPreviewTarget({ taskID: input.taskID, url, viewports: input.viewports })
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
