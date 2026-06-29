import assert from "node:assert/strict"

type BrowserEventEmitter = {
  on(event: "pageerror", listener: (error: unknown) => void): void
  on(event: "console", listener: (message: { type(): string; text(): string }) => void): void
  on(event: "response", listener: (response: { status(): number; url(): string }) => void): void
  on(
    event: "requestfailed",
    listener: (request: { url(): string; failure(): { errorText: string } | null }) => void,
  ): void
}

type BrowserResponse = {
  status: number
  url: string
  path: string
  pathWithSearch: string
}

type BrowserRequestFailure = {
  errorText: string
  url: string
  path: string
  pathWithSearch: string
}

export type BrowserErrorCollectorOptions = {
  allowConsoleError?: (message: { type: string; text: string }) => boolean
  allowPageError?: (error: unknown) => boolean
  allowResponse?: (response: BrowserResponse) => boolean
  allowRequestFailure?: (failure: BrowserRequestFailure) => boolean
}

export type BrowserErrorCollector = {
  readonly unexpectedErrors: string[]
  assertNoUnexpectedErrors(): void
}

type BrowserErrorCollectorEntry = {
  unexpectedErrors: string[]
  options: BrowserErrorCollectorOptions
  collector: BrowserErrorCollector
}

const collectors = new WeakMap<BrowserEventEmitter, BrowserErrorCollectorEntry>()

export function browserFixturePath(url: string): string {
  try {
    return new URL(url).pathname.replace(/\/+$/, "") || "/"
  } catch {
    return url
  }
}

export function browserFixturePathWithSearch(url: string): string {
  try {
    const parsed = new URL(url)
    const path = parsed.pathname.replace(/\/+$/, "") || "/"
    return `${path}${parsed.search}`
  } catch {
    return url
  }
}

export function installBrowserErrorCollector(
  page: BrowserEventEmitter,
  options: BrowserErrorCollectorOptions = {},
): BrowserErrorCollector {
  const existing = collectors.get(page)
  if (existing) {
    existing.options = options
    return existing.collector
  }
  const unexpectedErrors: string[] = []
  const entry: BrowserErrorCollectorEntry = {
    unexpectedErrors,
    options,
    collector: {
      unexpectedErrors,
      assertNoUnexpectedErrors() {
        assert.deepEqual(unexpectedErrors, [])
      },
    },
  }
  page.on("pageerror", (error) => {
    if (entry.options.allowPageError?.(error)) return
    const message = error instanceof Error ? error.message : String(error)
    unexpectedErrors.push(`pageerror: ${message}`)
  })
  page.on("console", (message) => {
    const type = message.type()
    const text = message.text()
    if (type !== "error") return
    if (text.includes("Failed to load resource")) return
    if (entry.options.allowConsoleError?.({ type, text })) return
    unexpectedErrors.push(`console: ${text}`)
  })
  page.on("response", (response) => {
    const status = response.status()
    if (status < 400) return
    const url = response.url()
    const path = browserFixturePath(url)
    const pathWithSearch = browserFixturePathWithSearch(url)
    if (entry.options.allowResponse?.({ status, url, path, pathWithSearch })) return
    unexpectedErrors.push(`${status} ${url}`)
  })
  page.on("requestfailed", (request) => {
    const url = request.url()
    const path = browserFixturePath(url)
    const pathWithSearch = browserFixturePathWithSearch(url)
    const errorText = request.failure()?.errorText || "request failed"
    if (entry.options.allowRequestFailure?.({ errorText, url, path, pathWithSearch })) return
    unexpectedErrors.push(`requestfailed: ${errorText} ${url}`)
  })

  collectors.set(page, entry)
  return entry.collector
}
