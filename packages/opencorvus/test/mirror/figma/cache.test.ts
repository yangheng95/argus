import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { rmSync, existsSync, readFileSync, statSync, utimesSync, readdirSync } from "node:fs"
import { resolve } from "node:path"
import os from "node:os"

import {
  buildFigmaCacheKey,
  getFigmaCached,
  setFigmaCache,
  getFigmaCacheDir,
  FIGMA_CACHE_TTL_MS,
  FIGMA_CACHE_MAX_ENTRIES,
  _resetCacheDirForTesting,
} from "../../../src/mirror/figma/cache"
import type { CompressedDesign } from "../../../src/mirror/ir/compressed-design"

// Redirect OPENCORVUS_HOME so writes land in a per-test tmp directory.
const TEST_HOME = resolve(os.tmpdir(), `mirror-figma-cache-${process.pid}-${Date.now()}`)

beforeEach(() => {
  process.env.OPENCORVUS_HOME = TEST_HOME
  _resetCacheDirForTesting()
})

afterEach(() => {
  delete process.env.OPENCORVUS_HOME
  _resetCacheDirForTesting()
  try {
    rmSync(TEST_HOME, { recursive: true, force: true })
  } catch {
    // Windows file locks sometimes delay cleanup — not fatal.
  }
})

function minimalDesign(url: string): CompressedDesign {
  return {
    fileName: "Test",
    lastModified: "2026-04-01T00:00:00Z",
    figmaUrl: url,
    pages: [{ name: "Page 1", frames: [{ id: "1:1", name: "F", type: "FRAME" }] }],
    components: {},
    componentSets: {},
    tokens: { colors: {}, gradients: [], fonts: [], textStyles: [], effects: [] },
    images: {},
    comments: [],
    stats: { totalNodes: 1, compressedNodes: 1, imageCount: 0, compressionRatio: "1.00" },
  }
}

describe("buildFigmaCacheKey", () => {
  test("deterministic — same input produces same key", () => {
    const a = buildFigmaCacheKey("https://figma.com/file/abc/Test", "1:2")
    const b = buildFigmaCacheKey("https://figma.com/file/abc/Test", "1:2")
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{16}$/)
  })

  test("different nodeIds → different keys", () => {
    const a = buildFigmaCacheKey("https://figma.com/x", "1:1")
    const b = buildFigmaCacheKey("https://figma.com/x", "2:2")
    expect(a).not.toBe(b)
  })

  test("strips volatile ?t= session param", () => {
    const a = buildFigmaCacheKey("https://figma.com/x?t=session1", "1:1")
    const b = buildFigmaCacheKey("https://figma.com/x?t=session2", "1:1")
    const c = buildFigmaCacheKey("https://figma.com/x", "1:1")
    expect(a).toBe(b)
    expect(a).toBe(c)
  })

  test("strips &t= mid-query", () => {
    const a = buildFigmaCacheKey("https://figma.com/x?mode=dev&t=session1", "1:1")
    const b = buildFigmaCacheKey("https://figma.com/x?mode=dev", "1:1")
    expect(a).toBe(b)
  })

  test("missing nodeId → stable key", () => {
    const a = buildFigmaCacheKey("https://figma.com/x")
    const b = buildFigmaCacheKey("https://figma.com/x")
    expect(a).toBe(b)
  })
})

describe("get / set roundtrip", () => {
  test("returns undefined on miss", () => {
    expect(getFigmaCached("https://figma.com/does-not-exist")).toBeUndefined()
  })

  test("set then get returns the same object", () => {
    const url = "https://figma.com/file/abc/Test"
    const design = minimalDesign(url)
    setFigmaCache(url, "1:1", design)
    const hit = getFigmaCached(url, "1:1")
    expect(hit).toBeDefined()
    expect(hit?.fileName).toBe("Test")
    expect(hit?.figmaUrl).toBe(url)
  })

  test("key derivation includes nodeId — different nodes, different slots", () => {
    const url = "https://figma.com/file/abc/Test"
    setFigmaCache(url, "1:1", { ...minimalDesign(url), fileName: "A" })
    setFigmaCache(url, "2:2", { ...minimalDesign(url), fileName: "B" })
    expect(getFigmaCached(url, "1:1")?.fileName).toBe("A")
    expect(getFigmaCached(url, "2:2")?.fileName).toBe("B")
  })

  test("writes land under Global.Path.cache/mirror-figma-extracts/", () => {
    const url = "https://figma.com/x"
    setFigmaCache(url, undefined, minimalDesign(url))
    const dir = getFigmaCacheDir()
    expect(dir).toContain("mirror-figma-extracts")
    expect(dir.startsWith(TEST_HOME)).toBe(true)
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"))
    expect(files.length).toBe(1)
  })
})

describe("TTL behavior", () => {
  test("entry older than TTL returns undefined", () => {
    const url = "https://figma.com/x"
    setFigmaCache(url, undefined, minimalDesign(url))
    const key = buildFigmaCacheKey(url)
    const filePath = resolve(getFigmaCacheDir(), `${key}.json`)

    // Back-date mtime past TTL.
    const ancient = new Date(Date.now() - FIGMA_CACHE_TTL_MS - 60_000)
    utimesSync(filePath, ancient, ancient)

    expect(getFigmaCached(url)).toBeUndefined()
  })

  test("entry within TTL still hits", () => {
    const url = "https://figma.com/x"
    setFigmaCache(url, undefined, minimalDesign(url))
    expect(getFigmaCached(url)).toBeDefined()
  })
})

describe("schema validation on read", () => {
  test("corrupted JSON payload returns undefined, does not throw", () => {
    // Plant an invalid JSON blob at a cache-key path.
    const url = "https://figma.com/x"
    setFigmaCache(url, undefined, minimalDesign(url))
    const key = buildFigmaCacheKey(url)
    const filePath = resolve(getFigmaCacheDir(), `${key}.json`)
    // Overwrite with garbage
    require("node:fs").writeFileSync(filePath, "{ broken json", "utf-8")
    expect(getFigmaCached(url)).toBeUndefined()
  })

  test("payload missing required fields returns undefined", () => {
    const url = "https://figma.com/x"
    setFigmaCache(url, undefined, minimalDesign(url))
    const key = buildFigmaCacheKey(url)
    const filePath = resolve(getFigmaCacheDir(), `${key}.json`)
    require("node:fs").writeFileSync(filePath, JSON.stringify({ figmaUrl: url }), "utf-8")
    expect(getFigmaCached(url)).toBeUndefined()
  })
})

describe("eviction", () => {
  test("over-cap caps total entries at MAX", () => {
    // Write MAX + 10 entries; eviction runs inside each setFigmaCache once
    // the threshold is exceeded, so the final count must be ≤ MAX.
    for (let i = 0; i < FIGMA_CACHE_MAX_ENTRIES + 10; i++) {
      const url = `https://figma.com/x${i}`
      setFigmaCache(url, undefined, minimalDesign(url))
    }
    const remaining = readdirSync(getFigmaCacheDir()).filter((f) => f.endsWith(".json"))
    expect(remaining.length).toBeLessThanOrEqual(FIGMA_CACHE_MAX_ENTRIES)
    expect(remaining.length).toBeGreaterThan(0)
  })

  test("eviction preserves the most recently written entries", () => {
    // Write MAX + 5 entries with explicit, monotonically-increasing mtimes
    // BEFORE the next write triggers eviction. The newest entries must survive.
    const urls: string[] = []
    for (let i = 0; i < FIGMA_CACHE_MAX_ENTRIES + 5; i++) {
      urls.push(`https://figma.com/x${i}`)
    }
    // First fill cache without crossing threshold.
    for (let i = 0; i < FIGMA_CACHE_MAX_ENTRIES; i++) {
      setFigmaCache(urls[i], undefined, minimalDesign(urls[i]))
      const key = buildFigmaCacheKey(urls[i])
      const filePath = resolve(getFigmaCacheDir(), `${key}.json`)
      const t = new Date(Date.now() - (FIGMA_CACHE_MAX_ENTRIES - i) * 1000)
      utimesSync(filePath, t, t)
    }
    // Now push one more — triggers eviction of ~20% oldest.
    setFigmaCache(urls[FIGMA_CACHE_MAX_ENTRIES], undefined, minimalDesign(urls[FIGMA_CACHE_MAX_ENTRIES]))
    const remaining = readdirSync(getFigmaCacheDir()).filter((f) => f.endsWith(".json"))
    expect(remaining.length).toBeLessThanOrEqual(FIGMA_CACHE_MAX_ENTRIES)
    // The newest-written entry must survive.
    const latestKey = buildFigmaCacheKey(urls[FIGMA_CACHE_MAX_ENTRIES])
    expect(remaining).toContain(`${latestKey}.json`)
  })
})

describe("buildFigmaCacheKey", () => {
  function expectedBuildKey(figmaUrl: string, nodeId?: string): string {
    const normalised = figmaUrl.replace(/[?&]t=[^&]+/g, "").replace(/\?$/, "")
    const raw = nodeId ? `${normalised}#${nodeId}` : normalised
    return require("node:crypto").createHash("sha256").update(raw).digest("hex").slice(0, 16)
  }

  const cases: Array<[string, string?]> = [
    ["https://figma.com/file/abc", "1:2"],
    ["https://figma.com/file/abc?t=XYZ123", "1:2"],
    ["https://figma.com/file/abc?mode=dev&t=XYZ&v=2", "1:2"],
    ["https://figma.com/file/abc", undefined],
    ["https://figma.com/file/abc?", undefined],
    ["https://figma.com/file/abc?t=S1", undefined],
  ]

  test.each(cases)("buildFigmaCacheKey(%p, %p) derives a stable normalized hash", (url, node) => {
    expect(buildFigmaCacheKey(url, node)).toBe(expectedBuildKey(url, node))
  })
})
