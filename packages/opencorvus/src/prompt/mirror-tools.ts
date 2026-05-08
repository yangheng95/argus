/**
 * Shared "Web Tooling" prompt section — injected into every sub-agent's user
 * prompt so they all reach for the same pipeline and all see what has already
 * been captured.
 *
 * Two things matter:
 *
 * 1. **Pipeline steering** — `webpage_extract` + siblings are the authoritative
 *    path for any URL the agent wants to clone / render / analyze visually.
 *    `webfetch` is for pure-text content only. Without this steering, every
 *    sub-agent tends to reach for `webfetch` first (its description is softer
 *    about "prefer other tools when available") and misses the whole mirror
 *    pipeline.
 *
 * 2. **Cross-agent dedup** — mirror artifacts land in a shared worktree dir
 *    (`mirror/`). Any sub-agent sees what prior stages captured
 *    and reads from disk instead of re-hitting the live URL. This is the
 *    architectural payoff of centralising mirror artifacts in the first place
 *    (`src/mirror/tools/output-dir.ts`) — prompts must actually surface it.
 *
 * 3. **Ground-truth enforcement + materialisation** — captured artifacts
 *    (`scaffold.json`, `shared-context.md`) and generated source files declared
 *    by the scaffold are the authoritative source for any visual clone of the
 *    URL. Sub-agents must refine the generated source in place instead of
 *    copying old mirror reference files or writing a competing scaffold.
 *
 * Static teaching is short (~150 tokens) to keep overhead low for tasks that
 * have nothing to do with webpages. The cache listing only appears when the
 * mirror dir is non-empty.
 */
import fs from "node:fs"
import path from "node:path"

import { DEFAULT_MIRROR_SUBDIR } from "@/mirror/tools/output-dir"

export interface MirrorCacheEntry {
  url: string
  extractedAtIso: string
  extractedJson: string
  scaffoldReady: boolean
  renderReady: boolean
  pageIrReady: boolean
  diffReady: boolean
  sourcePaths: string[]
}

/**
 * Build the shared "Web Tooling" section for a sub-agent prompt.
 *
 * Always emits the pipeline steering block. Appends the mirror-cache listing
 * only when `<cwd>/mirror/` contains at least one
 * `extracted-page.json`. Caller decides where to splice the returned string
 * into its own prompt sections (typically right before the final "finalize"
 * instruction).
 */
export function buildMirrorToolsPromptSection(opts: { cwd: string }): string {
  const mirrorDir = path.join(opts.cwd, DEFAULT_MIRROR_SUBDIR)
  const cache = scanMirrorCache(mirrorDir)

  const teaching = [
    "# Web Tooling",
    "",
    "For any URL you want to clone, render, analyze visually, extract design",
    "tokens from, or reproduce visually, use the `webpage_*` mirror pipeline —",
    "NOT `webfetch`. `webfetch` handles pure-text content (API docs,",
    "README, plain JSON/XML) only.",
    "",
    "Pipeline (strict order, each step reads the previous step's artifact):",
    "  1. `webpage_extract`  URL → `reference.png` + `extracted-page.json`",
    "                        (DOM tree + ~33 CSS props/element + tokens + assets)",
    "  2. `webpage_compile`  extracted-page.json → `page-ir.xml` (compact XML IR)",
    "  3. `webpage_analyze`  extracted-page.json → `scaffold.json` +",
    "                        `shared-context.md` + generated React source paths",
    "  4. (agent refines generated source)",
    "  5. `webpage_render`   url=<http(s)://...> → `rendered.png`",
    "  6. `webpage_vision_judge` (reference.png, rendered.png) → acceptance verdict",
    "  7. `webpage_evaluate` (reference.png, rendered.png) → diagnostic score + `diff.png`",
    "  8. `webpage_text_diff` url=<http(s)://...> (diagnostic only) → list of missing text tokens",
    "",
    "Steps 2/3 MUST NOT share a turn with step 1 — `extracted-page.json` has",
    "to be written to disk first. Steps 5/6 MUST NOT share a turn with the",
    "edit that produced the current generated source.",
  ].join("\n")

  if (cache.length === 0) {
    return teaching
  }

  const cacheLines = cache.map((entry) => {
    const extras: string[] = []
    if (entry.pageIrReady) extras.push("page-ir.xml")
    if (entry.scaffoldReady) extras.push("scaffold.json")
    if (entry.renderReady) extras.push("rendered.png")
    if (entry.diffReady) extras.push("diff.png")
    const extrasText = extras.length > 0 ? ` (+ ${extras.join(", ")})` : ""
    return `- **${entry.url}** → \`${entry.extractedJson}\`${extrasText} — captured ${entry.extractedAtIso}`
  })

  const sourceLines = cache.flatMap((entry) => {
    if (entry.sourcePaths.length === 0) return []
    return [
      `Generated source paths for **${entry.url}**:`,
      ...entry.sourcePaths.map((filePath) => `  - \`${filePath}\``),
    ]
  })
  const sourceSection = sourceLines.length > 0
    ? ["", "## Generated Source Paths", "", ...sourceLines]
    : []

  const cacheSection = [
    "",
    `## Mirror Cache (\`${mirrorDir}\`)`,
    "",
    "These URLs have already been captured for this task. Do NOT call",
    "`webpage_extract` or `webfetch` on them again — read the existing",
    "artifacts directly. Re-extraction overwrites the previous capture and",
    "invalidates any downstream work that cited it.",
    "",
    "**The cached artifacts are ground truth, not reference material.** For",
    "any visual clone of these URLs, the implementation MUST be built on",
    "top of the captured `scaffold.json` / `shared-context.md` and generated",
    "source paths declared by `scaffold.json`.",
    "",
    "Required action: refine the generated source paths listed in",
    "`scaffold.json` in place. Read `mirror/shared-context.md`,",
    "`mirror/page-ir.xml`, and `mirror/scaffold.json` before changing layout,",
    "copy, assets, tokens, or component boundaries.",
    ...sourceSection,
    "",
    "Forbidden:",
    "  - redefining the same tokens (colors, typography, spacing) with",
    "    different values from the scaffold's generated token file;",
    "  - demoting the captured artifacts to \"supplementary\" / \"reference\"",
    "    while shipping a competing theme or scaffold of your own design;",
    "  - implementing the page from the screenshot or your own taste while",
    "    leaving the generated scaffold source unused.",
    "",
    "If you believe a captured artifact is wrong (token mismatch, missing",
    "section, misclassified component), raise the conflict explicitly in",
    "your decision log and stop — do not silently override it.",
    "",
    ...cacheLines,
  ].join("\n")

  return teaching + "\n" + cacheSection
}

function scanMirrorCache(mirrorDir: string): MirrorCacheEntry[] {
  const results: MirrorCacheEntry[] = []

  const direct = readMirrorEntry(mirrorDir)
  if (direct) results.push(direct)

  let entries: fs.Dirent[] = []
  try {
    entries = fs.readdirSync(mirrorDir, { withFileTypes: true })
  } catch {
    return results
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const sub = readMirrorEntry(path.join(mirrorDir, entry.name))
    if (sub) results.push(sub)
  }
  return results
}

function readMirrorEntry(dir: string): MirrorCacheEntry | null {
  const jsonPath = path.join(dir, "extracted-page.json")
  let stat: fs.Stats
  try {
    stat = fs.statSync(jsonPath)
  } catch {
    return null
  }
  let payload: unknown
  try {
    payload = JSON.parse(fs.readFileSync(jsonPath, "utf8"))
  } catch {
    return null
  }
  const url = typeof (payload as { url?: unknown })?.url === "string"
    ? ((payload as { url: string }).url)
    : null
  if (!url) return null
  return {
    url,
    extractedAtIso: stat.mtime.toISOString(),
    extractedJson: jsonPath,
    pageIrReady: fs.existsSync(path.join(dir, "page-ir.xml")),
    scaffoldReady: fs.existsSync(path.join(dir, "scaffold.json")),
    renderReady: fs.existsSync(path.join(dir, "rendered.png")),
    diffReady: fs.existsSync(path.join(dir, "diff.png")),
    sourcePaths: readGeneratedSourcePaths(dir),
  }
}

function readGeneratedSourcePaths(dir: string): string[] {
  const scaffoldPath = path.join(dir, "scaffold.json")
  if (!fs.existsSync(scaffoldPath)) return []

  const scaffold = JSON.parse(fs.readFileSync(scaffoldPath, "utf8")) as {
    tokensFile?: { filePath?: unknown }
    appFile?: { filePath?: unknown }
    sharedComponents?: Array<{ filePath?: unknown }>
    sections?: Array<{
      file?: { filePath?: unknown }
      subComponents?: Array<{ filePath?: unknown }>
    }>
  }

  const paths = [
    scaffold.tokensFile?.filePath,
    scaffold.appFile?.filePath,
    ...(scaffold.sharedComponents ?? []).map((file) => file.filePath),
    ...(scaffold.sections ?? []).flatMap((section) => [
      section.file?.filePath,
      ...(section.subComponents ?? []).map((file) => file.filePath),
    ]),
  ]
  return Array.from(new Set(paths.filter((filePath): filePath is string => typeof filePath === "string")))
}
