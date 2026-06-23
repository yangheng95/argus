// ── API Client ──
// Provides server URL detection, auth headers,
// and typed helpers for the OpenCorvus overlay.
//
// Internally everything HTTP-shaped routes through `HostTransport.request`
// so this module stays usable identically under both the Tauri overlay
// and the VS Code webview (plan-vscode-extension.md §5.1, §11). Public
// signatures (apiUrl, apiHeaders, apiJson, fetchResourceAsObjectUrl) are
// unchanged so existing callers keep working without edits.

import { routeRequiresProjectDirectory } from "@opencorvus-ai/transport-protocol"
import { DEFAULT_SERVER } from "./default-server"
import { getHostTransport } from "./host-transport"
import type { ResponseKind, TransportResponse } from "./host-transport"
import { bytesToArrayBuffer } from "../utils/binary"

export { DEFAULT_SERVER }

let serverUrl = DEFAULT_SERVER
let authCredentials = { username: "opencorvus", password: "" }
let directoryContext = ""

// audit-2026-04-29 W2-V1 — when the user rotates the sidecar password
// or switches server, any open SSE EventSource is still authed against
// the OLD credential. The browser's native EventSource never re-evaluates
// headers/url after construction, so streams silently 401/leak until
// the next route change. Listeners notified here let the transports
// proactively tear down active streams; their business-side reconnect
// (services/sse.ts onClose path) re-opens with the new headers.
const authChangeListeners = new Set<() => void>()

export function onAuthChange(listener: () => void): () => void {
  authChangeListeners.add(listener)
  return () => {
    authChangeListeners.delete(listener)
  }
}

function fireAuthChange(): void {
  for (const l of [...authChangeListeners]) {
    try {
      l()
    } catch (err) {
      console.error("[api] auth change listener threw", err)
    }
  }
}

export function configure(opts: { serverUrl?: string; username?: string; password?: string; directory?: string }) {
  let credentialChanged = false
  if (opts.serverUrl && opts.serverUrl !== serverUrl) {
    serverUrl = opts.serverUrl
    credentialChanged = true
  }
  if (opts.username && opts.username !== authCredentials.username) {
    authCredentials.username = opts.username
    credentialChanged = true
  }
  if (opts.password !== undefined && opts.password !== authCredentials.password) {
    authCredentials.password = opts.password
    credentialChanged = true
  }
  if (opts.directory !== undefined) directoryContext = String(opts.directory || "").trim()
  if (credentialChanged) fireAuthChange()
}

export function getServerUrl(): string {
  return serverUrl
}

type QueryMap = Record<string, string | number | boolean | undefined | null>

export class ProjectDirectoryRequiredError extends Error {
  override readonly name = "ProjectDirectoryRequiredError"
  constructor(
    readonly path: string,
    readonly method: string,
  ) {
    super(`Project-scoped route ${method} /${path.replace(/^\/+/, "")} requires a configured directory`)
  }
}

function splitPathQuery(path: string): { pathOnly: string; query: Record<string, string> | undefined } {
  const qIdx = path.indexOf("?")
  if (qIdx < 0) return { pathOnly: path, query: undefined }
  const pathOnly = path.slice(0, qIdx)
  const params = new URLSearchParams(path.slice(qIdx + 1))
  const query: Record<string, string> = {}
  params.forEach((v, k) => {
    query[k] = v
  })
  return { pathOnly, query }
}

export function queryWithDirectory(
  path: string,
  query?: QueryMap,
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
): Record<string, string | number | boolean> | undefined {
  const pathOnly = path.replace(/^\/+/, "")
  const next: Record<string, string | number | boolean> = {}
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue
      next[k] = v
    }
  }
  if (routeRequiresProjectDirectory(pathOnly, method) && directoryContext && next.directory === undefined) {
    next.directory = directoryContext
  }
  return Object.keys(next).length > 0 ? next : undefined
}

function hasDirectoryQuery(query: Record<string, string | number | boolean> | undefined): boolean {
  if (!query || query.directory === undefined) return false
  return String(query.directory).trim().length > 0
}

function requireProjectDirectoryQuery(
  pathOnly: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  query: Record<string, string | number | boolean> | undefined,
): void {
  if (!routeRequiresProjectDirectory(pathOnly, method)) return
  if (hasDirectoryQuery(query)) return
  throw new ProjectDirectoryRequiredError(pathOnly, method)
}

function requestTarget(
  path: string,
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
): {
  pathOnly: string
  query: Record<string, string | number | boolean> | undefined
} {
  const url = relativePath(path)
  const { pathOnly, query } = splitPathQuery(url)
  const requestMethod = method ?? "GET"
  const nextQuery = queryWithDirectory(pathOnly, query, requestMethod)
  requireProjectDirectoryQuery(pathOnly, requestMethod, nextQuery)
  return {
    pathOnly,
    query: nextQuery,
  }
}

export function apiUrl(path: string): string {
  const base = serverUrl.replace(/\/+$/, "")
  const next = path.replace(/^\/+/, "")
  const { pathOnly, query } = splitPathQuery(next)
  const url = new URL(`${base}/${pathOnly}`)
  const nextQuery = queryWithDirectory(pathOnly, query, "GET")
  if (nextQuery) {
    for (const [k, v] of Object.entries(nextQuery)) {
      url.searchParams.set(k, String(v))
    }
  }
  return url.toString()
}

export function apiHeaders(): Record<string, string> {
  const h: Record<string, string> = { Accept: "application/json" }
  if (authCredentials.password) {
    h.Authorization = `Basic ${btoa(`${authCredentials.username}:${authCredentials.password}`)}`
  }
  return h
}

/**
 * Build a TransportRequest body from a legacy RequestInit.body. Most
 * callers pass JSON.stringify(...) bodies + Content-Type header, so we
 * detect that and forward the parsed value to keep the bridge JSON-aware
 * (binary base64 payloads on the postMessage hop are a measurable cost).
 */
function bodyFromInit(init?: RequestInit) {
  if (!init?.body) return undefined as undefined
  if (typeof init.body === "string") {
    const ct = pickHeader(init.headers, "Content-Type") || pickHeader(init.headers, "content-type") || ""
    if (ct.toLowerCase().startsWith("application/json")) {
      try {
        return { kind: "json" as const, value: JSON.parse(init.body) }
      } catch {
        // Fall through to text — non-JSON content typed as JSON is a caller bug,
        // surface as text rather than swallowing.
      }
    }
    return { kind: "text" as const, value: init.body }
  }
  if (init.body instanceof FormData) return { kind: "form" as const, value: init.body }
  if (init.body instanceof Uint8Array) return { kind: "binary" as const, value: init.body }
  if (init.body instanceof ArrayBuffer) return { kind: "binary" as const, value: new Uint8Array(init.body) }
  // Other BodyInit shapes (Blob, ReadableStream) are not used by the
  // overlay today; throw rather than silently dropping them.
  throw new Error(`apiJson: unsupported body type ${(init.body as object)?.constructor?.name ?? typeof init.body}`)
}

function pickHeader(h: HeadersInit | undefined, name: string): string | undefined {
  if (!h) return undefined
  if (h instanceof Headers) return h.get(name) ?? undefined
  if (Array.isArray(h)) {
    const found = h.find(([k]) => k.toLowerCase() === name.toLowerCase())
    return found?.[1]
  }
  const obj = h as Record<string, string>
  for (const [k, v] of Object.entries(obj)) {
    if (k.toLowerCase() === name.toLowerCase()) return v
  }
  return undefined
}

function methodFromInit(init?: RequestInit): "GET" | "POST" | "PUT" | "PATCH" | "DELETE" {
  const m = (init?.method ?? "GET").toUpperCase()
  if (m === "GET" || m === "POST" || m === "PUT" || m === "PATCH" || m === "DELETE") return m
  throw new Error(`apiJson: unsupported HTTP method ${m}`)
}

function headersFromInit(init?: RequestInit): Record<string, string> | undefined {
  const h = init?.headers
  if (!h) return undefined
  if (h instanceof Headers) {
    const out: Record<string, string> = {}
    h.forEach((v, k) => {
      out[k] = v
    })
    return out
  }
  if (Array.isArray(h)) return Object.fromEntries(h)
  return { ...(h as Record<string, string>) }
}

/**
 * Strip the absolute server URL prefix (if present) so HostTransport
 * sees a relative path. Callers historically passed either "task/abc"
 * or "/task/abc"; both must work.
 */
function relativePath(path: string): string {
  if (/^https?:/i.test(path)) {
    const u = new URL(path)
    return u.pathname.replace(/^\/+/, "") + (u.search || "")
  }
  return path.replace(/^\/+/, "")
}

/**
 * Lower-level companion to `apiJson`: returns the full TransportResponse
 * (status, headers, parsed body) so callers that need 304 / 409 / ETag /
 * raw bytes can stay on the HostTransport chokepoint without falling
 * back to direct `fetch`. Use this only when you need status or headers;
 * `apiJson` is still the preferred surface for plain JSON.
 */
export async function apiRequest<T = unknown>(
  path: string,
  init?: RequestInit & { responseKind?: ResponseKind },
): Promise<TransportResponse<T>> {
  const transport = getHostTransport()
  const method = methodFromInit(init)
  const { pathOnly, query } = requestTarget(path, method)
  return transport.request<T>({
    path: pathOnly,
    query,
    method,
    body: bodyFromInit(init),
    headers: headersFromInit(init),
    signal: init?.signal ?? undefined,
    responseKind: init?.responseKind ?? "json",
  })
}

/**
 * Thrown by `apiJson` whenever the host transport returns a non-2xx
 * response. Carries the raw status, the request path, and the parsed
 * response body so callers that need the original failure detail can
 * pattern-match (`err instanceof ApiError && err.status === 400 → form
 * field error`). The `message` is pre-rendered for `console.error` /
 * direct toast use, prefering common server-error fields (message,
 * error, detail) before falling back to JSON.stringify, so the previous
 * "API 400: config" stub never re-occurs.
 */
export class ApiError extends Error {
  readonly status: number
  readonly path: string
  readonly body: unknown
  constructor(status: number, path: string, body: unknown) {
    super(formatApiErrorMessage(status, path, body))
    this.name = "ApiError"
    this.status = status
    this.path = path
    this.body = body
  }
}

function formatApiErrorMessage(status: number, path: string, body: unknown): string {
  const detail = pickServerErrorDetail(body)
  return detail ? `API ${status} ${path}: ${detail}` : `API ${status} ${path}`
}

function pickServerErrorDetail(body: unknown): string {
  if (body == null) return ""
  if (typeof body === "string") return body.trim()
  if (typeof body !== "object") return String(body)
  const obj = body as Record<string, unknown>
  // Hono / OpenAPI helpers tend to use one of these. Order matters: hono's
  // HTTPException default uses `message`, our errors() helper sometimes
  // uses `error`, RFC 7807 / generic frameworks use `detail`.
  for (const key of ["message", "error", "detail"]) {
    const v = obj[key]
    if (typeof v === "string" && v.trim()) return v.trim()
  }
  try {
    return JSON.stringify(body)
  } catch {
    return ""
  }
}

// Return type is intentionally `any` (not `unknown`) so this remains a
// drop-in replacement for the pre-M3 `fetch().then(r => r.json())` chain.
// Callers across the overlay rely on field-level access without first
// narrowing — preserving that behaviour keeps M3.A a pure plumbing
// change. Dedicated typed wrappers can land later in the services layer.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function apiJson(path: string, init?: RequestInit): Promise<any> {
  const transport = getHostTransport()
  const method = methodFromInit(init)
  const { pathOnly, query } = requestTarget(path, method)
  const res = await transport.request({
    path: pathOnly,
    query,
    method,
    body: bodyFromInit(init),
    headers: headersFromInit(init),
    signal: init?.signal ?? undefined,
    responseKind: "json",
  })
  if (!res.ok) throw new ApiError(res.status, path, res.body)
  return res.body
}

function mergeAbortSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (a.aborted) return a
  if (b.aborted) return b
  const controller = new AbortController()
  const abort = () => controller.abort()
  a.addEventListener("abort", abort, { once: true })
  b.addEventListener("abort", abort, { once: true })
  return controller.signal
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return String(error)
}

export async function apiJsonWithTimeout<T = unknown>(
  path: string,
  timeoutMilliseconds: number,
  init?: RequestInit,
): Promise<T> {
  const timeoutSignal = AbortSignal.timeout(timeoutMilliseconds)
  const signal = init?.signal ? mergeAbortSignals(init.signal, timeoutSignal) : timeoutSignal
  try {
    return (await apiJson(path, { ...init, signal })) as T
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new Error(`${path}: ${errorMessage(error)}`, {
      cause: error instanceof Error ? error : undefined,
    })
  }
}

// ── Resource URL resolution ──
// Server-side writers (AttachmentStore, etc.) persist URLs as
// server-relative paths like "/attachment/<projectID>/<sha>.<ext>". These
// cannot be dropped into <img src> / <a href> as-is: the browser resolves
// them against window.location.origin, which differs from the API server
// origin under Tauri (tauri://localhost) or any non-/ui deployment. Below
// is the single entry point for converting persisted resource URLs into
// something the webview can actually fetch.

/**
 * Resolve a persisted resource URL to an absolute URL the webview can load.
 *
 * - data: / blob: / http(s): / file: URLs are returned unchanged.
 * - Server-relative paths (leading "/") are prefixed with the configured
 *   serverUrl. The `directory` query parameter is deliberately NOT injected —
 *   attachment URLs carry `projectID` in their path and do not need Instance
 *   context; other resource routes are expected to follow the same discipline.
 * - Anything else is returned unchanged so callers can detect bare names.
 */
export function resolveResourceUrl(raw: string): string {
  if (!raw) return raw
  if (/^(?:data|blob|https?|file):/i.test(raw)) return raw
  if (raw.startsWith("/")) {
    const base = serverUrl.replace(/\/+$/, "")
    return `${base}${raw}`
  }
  return raw
}

// ── Blob object URL cache ──
//
// The naive implementation of `fetchResourceAsObjectUrl` coupled the blob
// URL's lifetime to the lifetime of the rendering component (via
// `URL.revokeObjectURL` in an onCleanup). In practice overlay components
// remount often — the Conversation tree is re-derived whenever upstream
// state flushes — and each remount forced a full re-fetch of an
// already-loaded image while the stale blob URL was revoked, producing
// visible flicker.
//
// Decoupling: keep a module-level map from the raw persisted URL to the
// blob object URL. The cache owns the blob's lifetime; component mounts
// only read from it. When the cache grows past its cap, it evicts the
// least-recently-used entry and revokes its blob URL at eviction time —
// no per-component cleanup needed.
//
// `Map` iteration order equals insertion order, so "touch-on-read" + eviction
// of the first key gives LRU behaviour without an extra data structure.

const BLOB_CACHE_MAX = 256
// audit-2026-04-29 W2-P4 — limit concurrent in-flight fetches so a
// component mounting 1000 thumbnails doesn't queue 1000 promises
// each holding ~MB closure state (image binary on the postMessage
// hop). 64 is twice typical viewport thumbnail count, plenty.
const BLOB_INFLIGHT_MAX = 64
const blobCache = new Map<string, string>()
const blobInFlight = new Map<string, Promise<string>>()
const blobInFlightWaiters: Array<() => void> = []

function touchCache(raw: string, url: string): void {
  blobCache.delete(raw)
  blobCache.set(raw, url)
}

/**
 * audit-2026-04-29 W2-P4 — evict BEFORE inserting, never after. The
 * pre-fix `set; evictIfNeeded()` pattern allowed the cache to reach
 * size 257 between the two statements. Concurrent resolve-and-set
 * across many promises could push it transiently much higher.
 */
function evictToFitOne(): void {
  while (blobCache.size >= BLOB_CACHE_MAX) {
    const oldest = blobCache.keys().next().value
    if (oldest === undefined) return
    const url = blobCache.get(oldest)
    blobCache.delete(oldest)
    if (url) URL.revokeObjectURL(url)
  }
}

async function reserveInFlightSlot(): Promise<void> {
  if (blobInFlight.size < BLOB_INFLIGHT_MAX) return
  return new Promise<void>((resolve) => {
    blobInFlightWaiters.push(resolve)
  })
}

function releaseInFlightSlot(): void {
  const next = blobInFlightWaiters.shift()
  if (next) next()
}

/**
 * Synchronous cache peek. Returns the blob object URL already materialised
 * for this raw resource URL, or `undefined` if nothing is cached. Callers
 * that are allowed to render cached media immediately can pass this to
 * `createResource`'s `initialValue`; staged or lazy renderers must peek only
 * after their reveal gate opens, so a warm cache cannot bypass their frame
 * budget.
 */
export function peekResourceObjectUrl(raw: string): string | undefined {
  if (!raw) return undefined
  const cached = blobCache.get(raw)
  if (cached) touchCache(raw, cached)
  return cached
}

/**
 * Fetch a persisted resource and return a blob object URL. Used when the
 * webview needs to display a resource via <img src> / <a href>: a raw
 * server-relative URL cannot carry Authorization headers on native-element
 * loads, and in cross-origin webview contexts (Tauri) it would resolve to
 * the wrong origin. Routing through `fetch` with `apiHeaders()` gets both.
 *
 * The returned URL is owned by the module-level cache — callers MUST NOT
 * `URL.revokeObjectURL` it. Blobs are revoked on LRU eviction.
 *
 * Concurrent calls for the same raw URL share a single in-flight fetch, so
 * two components mounting at the same moment don't double the network
 * traffic. Throws on network / HTTP errors — no fallback to the raw URL,
 * since that would silently mask origin / auth mistakes.
 */
export async function fetchResourceAsObjectUrl(raw: string): Promise<string> {
  const cached = blobCache.get(raw)
  if (cached) {
    touchCache(raw, cached)
    return cached
  }
  const inFlight = blobInFlight.get(raw)
  if (inFlight) return inFlight

  const pending = (async () => {
    // audit-2026-04-29 W2-P4 — bound concurrent fetches so a render
    // burst of 1000 thumbnails doesn't queue 1000 in-flight promises
    // each holding a closure over the transport request.
    await reserveInFlightSlot()
    const transport = getHostTransport()
    try {
      // Resource URLs may already be absolute (server-relative paths
      // start with "/" — those go through transport; data:/blob:/http(s)/
      // file: URLs short-circuit to plain fetch since transport can't
      // proxy arbitrary external schemes).
      if (/^(?:data|blob|file):/i.test(raw)) {
        const res = await fetch(raw)
        if (!res.ok) throw new Error(`resource ${res.status}: ${raw}`)
        const blob = await res.blob()
        const objectUrl = URL.createObjectURL(blob)
        evictToFitOne()
        blobCache.set(raw, objectUrl)
        return objectUrl
      }
      if (/^https?:/i.test(raw)) {
        // External web image — webview CSP already restricts these
        // sources (plan §19.2.1); plain fetch is the right path.
        const res = await fetch(raw)
        if (!res.ok) throw new Error(`resource ${res.status}: ${raw}`)
        const blob = await res.blob()
        const objectUrl = URL.createObjectURL(blob)
        evictToFitOne()
        blobCache.set(raw, objectUrl)
        return objectUrl
      }
      const path = raw.replace(/^\/+/, "")
      const res = await transport.request<Uint8Array>({
        path,
        method: "GET",
        responseKind: "binary",
      })
      if (!res.ok) throw new Error(`resource ${res.status}: ${raw}`)
      const ct = res.headers["content-type"] || res.headers["Content-Type"] || "application/octet-stream"
      const blob = new Blob([bytesToArrayBuffer(res.body as Uint8Array)], { type: ct })
      const objectUrl = URL.createObjectURL(blob)
      evictToFitOne()
      blobCache.set(raw, objectUrl)
      return objectUrl
    } finally {
      releaseInFlightSlot()
    }
  })()

  blobInFlight.set(raw, pending)
  try {
    return await pending
  } finally {
    blobInFlight.delete(raw)
  }
}
