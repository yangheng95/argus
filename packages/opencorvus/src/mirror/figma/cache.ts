/**
 * Figma extract cache — a standalone KV tool for `CompressedDesign` objects
 * keyed by `(figmaUrl, nodeId?)`. **Not** an implicit backend for
 * `figma/fetch-tree` — skills decide whether to consult the cache before
 * calling fetch, and what to do on miss.
 *
 * Ported from `mirror/src/infra/figma-cache.ts`. Adaptations:
 *   - Cache dir: `Global.Path.cache/mirror-figma-extracts/` (XDG-compliant,
 *     survives `cwd` changes), not `./.mirror-cache/`
 *   - Silent `catch` → `Log.create({ service: "mirror.figma.cache" })`
 *   - Schema-validated read: stale/corrupted entries return undefined
 *     instead of throwing (cache is an optimisation, not a source of truth)
 */

import { createHash } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  statSync,
  readdirSync,
  unlinkSync,
} from "node:fs"
import { resolve } from "node:path"

import { Global } from "@/global"
import { Log } from "@/util/log"
import { CompressedDesignSchema, type CompressedDesign } from "../ir/compressed-design"

const log = Log.create({ service: "mirror.figma.cache" })

export const FIGMA_CACHE_TTL_MS = 24 * 60 * 60 * 1000
export const FIGMA_CACHE_MAX_ENTRIES = 100

let _cacheDir: string | undefined

function cacheDir(): string {
  if (!_cacheDir) {
    _cacheDir = resolve(Global.Path.cache, "mirror-figma-extracts")
    mkdirSync(_cacheDir, { recursive: true })
  }
  return _cacheDir
}

/** Resolved cache directory — exposed for debugging and skill-side cleanup. */
export function getFigmaCacheDir(): string {
  return cacheDir()
}

/**
 * Deterministic cache key from URL + optional nodeId. Strips volatile `t=`
 * session params so the same frame shared at different times hits the same
 * slot.
 */
export function buildFigmaCacheKey(figmaUrl: string, nodeId?: string): string {
  const normalised = figmaUrl.replace(/[?&]t=[^&]+/g, "").replace(/\?$/, "")
  const raw = nodeId ? `${normalised}#${nodeId}` : normalised
  return createHash("sha256").update(raw).digest("hex").slice(0, 16)
}

/**
 * Return a cached `CompressedDesign`, or undefined when:
 *   - no entry exists
 *   - the entry is older than {@link FIGMA_CACHE_TTL_MS}
 *   - the entry is corrupted / fails schema validation
 */
export function getFigmaCached(figmaUrl: string, nodeId?: string): CompressedDesign | undefined {
  try {
    const key = buildFigmaCacheKey(figmaUrl, nodeId)
    const filePath = resolve(cacheDir(), `${key}.json`)
    if (!existsSync(filePath)) return undefined

    const stat = statSync(filePath)
    if (Date.now() - stat.mtimeMs > FIGMA_CACHE_TTL_MS) return undefined

    const raw = JSON.parse(readFileSync(filePath, "utf-8")) as unknown
    const parsed = CompressedDesignSchema.safeParse(raw)
    if (!parsed.success) {
      log.warn("cache entry failed schema validation", { key, issues: parsed.error.issues.length })
      return undefined
    }
    return parsed.data
  } catch (err) {
    log.warn("cache read failed", { error: err instanceof Error ? err.message : String(err) })
    return undefined
  }
}

/**
 * Write `data` under the `(figmaUrl, nodeId)` key. Lazily evicts the oldest
 * 20% when the entry count exceeds {@link FIGMA_CACHE_MAX_ENTRIES}.
 *
 * Write failures are logged but not thrown — the cache is an optimisation,
 * never a hard dependency.
 */
export function setFigmaCache(figmaUrl: string, nodeId: string | undefined, data: CompressedDesign): void {
  try {
    const dir = cacheDir()
    const key = buildFigmaCacheKey(figmaUrl, nodeId)
    const filePath = resolve(dir, `${key}.json`)
    writeFileSync(filePath, JSON.stringify(data), "utf-8")
    evictIfNeeded(dir)
  } catch (err) {
    log.warn("cache write failed", { error: err instanceof Error ? err.message : String(err) })
  }
}

function evictIfNeeded(dir: string): void {
  try {
    const entries = readdirSync(dir).filter((f) => f.endsWith(".json"))
    if (entries.length <= FIGMA_CACHE_MAX_ENTRIES) return

    const withTime = entries.map((f) => {
      const path = resolve(dir, f)
      try {
        return { path, mtime: statSync(path).mtimeMs }
      } catch {
        return { path, mtime: 0 }
      }
    })
    withTime.sort((a, b) => a.mtime - b.mtime)

    const toRemove = Math.max(1, Math.floor(entries.length * 0.2))
    for (let i = 0; i < toRemove; i++) {
      try {
        unlinkSync(withTime[i].path)
      } catch (err) {
        log.warn("cache eviction unlink failed", {
          path: withTime[i].path,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
  } catch (err) {
    log.warn("cache eviction enumeration failed", {
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

/** Test hook — wipes the in-memory dir handle so the next call re-resolves. */
export function _resetCacheDirForTesting(): void {
  _cacheDir = undefined
}
