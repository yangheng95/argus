// ── API Client ──
// Provides server URL detection, auth headers,
// and typed fetch helpers for the OpenCorvus overlay.

import serverDefaults from "../../../opencorvus/server-defaults.json";

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

export async function apiJson(path: string, init?: RequestInit) {
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: { ...apiHeaders(), ...init?.headers },
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json();
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
    const url = resolveResourceUrl(raw);
    const res = await fetch(url, { headers: apiHeaders() });
    if (!res.ok) throw new Error(`resource ${res.status}: ${url}`);
    const blob = await res.blob();
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
