const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"])
const PREVIEW_TARGET_REACHABILITY_REQUEST_TIMEOUT_MS = 1_000
const PREVIEW_TARGET_REACHABILITY_TIMEOUT_MS = 5_000
const PREVIEW_TARGET_REACHABILITY_INTERVAL_MS = 250
const PREVIEW_TARGET_LIVENESS_CACHE_TTL_MS = 3_000
const livenessCache = new Map<string, { reachable: boolean; checkedAt: number }>()

export function isLoopbackBrowserPreviewUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return LOOPBACK_HOSTS.has(url.hostname.toLowerCase())
  } catch {
    return false
  }
}

export async function isBrowserPreviewTargetVisible(input: {
  url: string
  now?: number
  fetchImpl?: typeof fetch
}): Promise<boolean> {
  if (!isLoopbackBrowserPreviewUrl(input.url)) return true
  const now = input.now ?? Date.now()
  const cached = livenessCache.get(input.url)
  if (cached && now - cached.checkedAt <= PREVIEW_TARGET_LIVENESS_CACHE_TTL_MS) return cached.reachable
  const reachable = await probeBrowserPreviewUrl(input.url, input.fetchImpl ?? fetch)
  livenessCache.set(input.url, { reachable, checkedAt: now })
  return reachable
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
