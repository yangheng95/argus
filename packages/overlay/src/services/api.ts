// ── API Client ──
// Provides server URL detection, auth headers,
// and typed helpers for the OpenCorvus overlay.
//
// Internally everything HTTP-shaped routes through `HostTransport.request`
// so this module stays usable identically under both the Tauri overlay
// and the VS Code webview (plan-vscode-extension.md §5.1, §11). Public
// signatures (apiUrl, apiHeaders, apiJson, fetchResourceAsObjectUrl) are
// unchanged so existing callers keep working without edits.

import serverDefaults from "../../../opencorvus/server-defaults.json";
import { getHostTransport } from "./host-transport";
import type { ResponseKind, TransportResponse } from "./host-transport";

const DEFAULT_LOCAL_SERVER_URL = `http://${serverDefaults.host}:${serverDefaults.port}`;

export const DEFAULT_SERVER = (() => {
  if (
    typeof window !== "undefined" &&
    window.location.protocol.startsWith("http") &&
    window.location.pathname.startsWith("/ui")
  ) {
    return window.location.origin;
  }
  return DEFAULT_LOCAL_SERVER_URL;
})();

let serverUrl = DEFAULT_SERVER;
let authCredentials = { username: "opencorvus", password: "" };
let directoryContext = "";

export function configure(opts: {
  serverUrl?: string;
  username?: string;
  password?: string;
  directory?: string;
}) {
  if (opts.serverUrl) serverUrl = opts.serverUrl;
  if (opts.username) authCredentials.username = opts.username;
  if (opts.password !== undefined) authCredentials.password = opts.password;
  if (opts.directory !== undefined) directoryContext = String(opts.directory || "").trim();
}

export function getServerUrl(): string {
  return serverUrl;
}

export function apiUrl(path: string): string {
  const base = serverUrl.replace(/\/+$/, "");
  const next = path.replace(/^\/+/, "");
  const url = new URL(`${base}/${next}`);
  // Routes under /global and /auth run outside the Instance.provide middleware
  // and are explicitly cross-project; injecting ?directory= would cause
  // /global/tasks to be filtered to a single project.
  const isCrossProject = next.startsWith("global/") || next === "global" || next.startsWith("auth/") || next === "auth";
  if (!isCrossProject && directoryContext && !url.searchParams.has("directory")) {
    url.searchParams.set("directory", directoryContext);
  }
  return url.toString();
}

export function apiHeaders(): Record<string, string> {
  const h: Record<string, string> = { Accept: "application/json" };
  if (authCredentials.password) {
    h.Authorization = `Basic ${btoa(`${authCredentials.username}:${authCredentials.password}`)}`;
  }
  return h;
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
    const ct = pickHeader(init.headers, "Content-Type") || pickHeader(init.headers, "content-type") || "";
    if (ct.toLowerCase().startsWith("application/json")) {
      try {
        return { kind: "json" as const, value: JSON.parse(init.body) };
      } catch {
        // Fall through to text — non-JSON content typed as JSON is a caller bug,
        // surface as text rather than swallowing.
      }
    }
    return { kind: "text" as const, value: init.body };
  }
  if (init.body instanceof FormData) return { kind: "form" as const, value: init.body };
  if (init.body instanceof Uint8Array) return { kind: "binary" as const, value: init.body };
  if (init.body instanceof ArrayBuffer) return { kind: "binary" as const, value: new Uint8Array(init.body) };
  // Other BodyInit shapes (Blob, ReadableStream) are not used by the
  // overlay today; throw rather than silently dropping them.
  throw new Error(`apiJson: unsupported body type ${(init.body as object)?.constructor?.name ?? typeof init.body}`);
}

function pickHeader(h: HeadersInit | undefined, name: string): string | undefined {
  if (!h) return undefined;
  if (h instanceof Headers) return h.get(name) ?? undefined;
  if (Array.isArray(h)) {
    const found = h.find(([k]) => k.toLowerCase() === name.toLowerCase());
    return found?.[1];
  }
  const obj = h as Record<string, string>;
  for (const [k, v] of Object.entries(obj)) {
    if (k.toLowerCase() === name.toLowerCase()) return v;
  }
  return undefined;
}

function methodFromInit(init?: RequestInit): "GET" | "POST" | "PUT" | "PATCH" | "DELETE" {
  const m = (init?.method ?? "GET").toUpperCase();
  if (m === "GET" || m === "POST" || m === "PUT" || m === "PATCH" || m === "DELETE") return m;
  throw new Error(`apiJson: unsupported HTTP method ${m}`);
}

function headersFromInit(init?: RequestInit): Record<string, string> | undefined {
  const h = init?.headers;
  if (!h) return undefined;
  if (h instanceof Headers) {
    const out: Record<string, string> = {};
    h.forEach((v, k) => { out[k] = v });
    return out;
  }
  if (Array.isArray(h)) return Object.fromEntries(h);
  return { ...(h as Record<string, string>) };
}

/**
 * Strip the absolute server URL prefix (if present) so HostTransport
 * sees a relative path. Callers historically passed either "task/abc"
 * or "/task/abc"; both must work.
 */
function relativePath(path: string): string {
  if (/^https?:/i.test(path)) {
    const u = new URL(path);
    return u.pathname.replace(/^\/+/, "") + (u.search || "");
  }
  return path.replace(/^\/+/, "");
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
  const transport = getHostTransport();
  const url = relativePath(path);
  let pathOnly = url;
  let query: Record<string, string> | undefined;
  const qIdx = url.indexOf("?");
  if (qIdx >= 0) {
    pathOnly = url.slice(0, qIdx);
    const params = new URLSearchParams(url.slice(qIdx + 1));
    query = {};
    params.forEach((v, k) => { query![k] = v });
  }
  return transport.request<T>({
    path: pathOnly,
    query,
    method: methodFromInit(init),
    body: bodyFromInit(init),
    headers: headersFromInit(init),
    signal: init?.signal ?? undefined,
    responseKind: init?.responseKind ?? "json",
  });
}

// Return type is intentionally `any` (not `unknown`) so this remains a
// drop-in replacement for the pre-M3 `fetch().then(r => r.json())` chain.
// Callers across the overlay rely on field-level access without first
// narrowing — preserving that behaviour keeps M3.A a pure plumbing
// change. Dedicated typed wrappers can land later in the services layer.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function apiJson(path: string, init?: RequestInit): Promise<any> {
  const transport = getHostTransport();
  const url = relativePath(path);
  // Split query out so the transport can serialise it consistently
  // across Tauri and VSCode hosts.
  let pathOnly = url;
  let query: Record<string, string> | undefined;
  const qIdx = url.indexOf("?");
  if (qIdx >= 0) {
    pathOnly = url.slice(0, qIdx);
    const params = new URLSearchParams(url.slice(qIdx + 1));
    query = {};
    params.forEach((v, k) => { query![k] = v });
  }
  const res = await transport.request({
    path: pathOnly,
    query,
    method: methodFromInit(init),
    body: bodyFromInit(init),
    headers: headersFromInit(init),
    signal: init?.signal ?? undefined,
    responseKind: "json",
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.body;
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
  if (!raw) return raw;
  if (/^(?:data|blob|https?|file):/i.test(raw)) return raw;
  if (raw.startsWith("/")) {
    const base = serverUrl.replace(/\/+$/, "");
    return `${base}${raw}`;
  }
  return raw;
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

const BLOB_CACHE_MAX = 256;
const blobCache = new Map<string, string>();
const blobInFlight = new Map<string, Promise<string>>();

function touchCache(raw: string, url: string): void {
  blobCache.delete(raw);
  blobCache.set(raw, url);
}

function evictIfNeeded(): void {
  while (blobCache.size > BLOB_CACHE_MAX) {
    const oldest = blobCache.keys().next().value;
    if (oldest === undefined) return;
    const url = blobCache.get(oldest);
    blobCache.delete(oldest);
    if (url) URL.revokeObjectURL(url);
  }
}

/**
 * Synchronous cache peek. Returns the blob object URL already materialised
 * for this raw resource URL, or `undefined` if nothing is cached. Callers
 * that want a flicker-free first render should pass this to
 * `createResource`'s `initialValue` — even with a cache hit the fetcher
 * still runs, but `createResource`'s signal has the resolved value from
 * frame zero so any `<Show>` gate stays open through the mount.
 */
export function peekResourceObjectUrl(raw: string): string | undefined {
  if (!raw) return undefined;
  const cached = blobCache.get(raw);
  if (cached) touchCache(raw, cached);
  return cached;
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
  const cached = blobCache.get(raw);
  if (cached) {
    touchCache(raw, cached);
    return cached;
  }
  const inFlight = blobInFlight.get(raw);
  if (inFlight) return inFlight;

  const pending = (async () => {
    const transport = getHostTransport();
    // Resource URLs may already be absolute (server-relative paths
    // start with "/" — those go through transport; data:/blob:/http(s)/
    // file: URLs short-circuit to plain fetch since transport can't
    // proxy arbitrary external schemes).
    if (/^(?:data|blob|file):/i.test(raw)) {
      const res = await fetch(raw);
      if (!res.ok) throw new Error(`resource ${res.status}: ${raw}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      blobCache.set(raw, objectUrl);
      evictIfNeeded();
      return objectUrl;
    }
    if (/^https?:/i.test(raw)) {
      // External web image — webview CSP already restricts these
      // sources (plan §19.2.1); plain fetch is the right path.
      const res = await fetch(raw);
      if (!res.ok) throw new Error(`resource ${res.status}: ${raw}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      blobCache.set(raw, objectUrl);
      evictIfNeeded();
      return objectUrl;
    }
    const path = raw.replace(/^\/+/, "");
    const res = await transport.request<Uint8Array>({
      path,
      method: "GET",
      responseKind: "binary",
    });
    if (!res.ok) throw new Error(`resource ${res.status}: ${raw}`);
    const ct = res.headers["content-type"] || res.headers["Content-Type"] || "application/octet-stream";
    const blob = new Blob([res.body as Uint8Array], { type: ct });
    const objectUrl = URL.createObjectURL(blob);
    blobCache.set(raw, objectUrl);
    evictIfNeeded();
    return objectUrl;
  })();

  blobInFlight.set(raw, pending);
  try {
    return await pending;
  } finally {
    blobInFlight.delete(raw);
  }
}
