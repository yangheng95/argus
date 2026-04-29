#!/usr/bin/env bun
/**
 * Release-bundle audit (plan-vscode-extension.md §19.3.4 / M8).
 *
 * Greps the production esbuild output and the staged media/ui assets
 * for patterns that MUST NOT appear in a release VSIX:
 *
 *   - live `process.env.OPENCORVUS_DEV_*` reads. Esbuild's `define`
 *     rewrites these to `undefined` and dead-code-elims the branch
 *     (plan §17). A leftover means a release VSIX could be tricked
 *     into loading a dev sidecar / vite dev server at runtime.
 *
 *   - hard-coded `127.0.0.1` / sidecar-direct URLs. The webview never
 *     talks to the sidecar directly (plan §19.2.1) and the extension
 *     binds via the SidecarHandle, never a baked-in address.
 *
 *   - silent-fallback text patterns ("fallback", "兜底", "降级") in
 *     extension code or webview HTML, which would violate CLAUDE.md
 *     §一-7.
 *
 * Usage:
 *   bun run script/audit-bundle.ts
 *   exit 0 → clean. exit 1 → at least one violation.
 *
 * Run by:
 *   - bun test (via test/audit-bundle.test.ts) — fails the test
 *     suite at HEAD if a violation lands in main bundle output
 *   - manually before publishing a VSIX
 */

import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const extensionRoot = path.resolve(here, "..")

interface Violation {
  file: string
  pattern: string
  matches: string[]
}

/**
 * Patterns that must NOT appear ANYWHERE in the extension bundle
 * (`dist/extension.cjs`). These rules are EXTENSION-only — overlay's
 * media/ui bundle is dual-targeted (Tauri + webview) and legitimately
 * carries strings like `DEFAULT_LOCAL_SERVER_URL = "127.0.0.1:7878"`
 * for Tauri mode; vscode-transport hijacks the actual fetch path so
 * the literal is never used in webview mode. media/ui therefore has
 * its own audit profile in `MEDIA_UI_PATTERNS` below.
 *
 * NOTE: the manager.ts `env: { ..., OPENCORVUS_DEV_BINARY: undefined, ... }`
 * object key is a legitimate sidecar-spawn env strip — we look only
 * for *live* reads of `process.env.OPENCORVUS_DEV_*`, which esbuild's
 * `define` substitution should have erased.
 */
const FORBIDDEN_BUNDLE: Array<{
  description: string
  pattern: RegExp
}> = [
  {
    description: "live process.env read of OPENCORVUS_DEV_*",
    // process.env.NAME or process.env["NAME"]
    pattern: /process\s*\.\s*env\s*(?:\.\s*OPENCORVUS_DEV_[A-Z_]+|\[\s*["']OPENCORVUS_DEV_[A-Z_]+["']\s*\])/,
  },
  {
    description: "hard-coded 127.0.0.1 in extension bundle",
    pattern: /127\.0\.0\.1/,
  },
  {
    description: "fallback / 兜底 / 降级 marker (semantic check)",
    pattern: /\b(fallback|FALLBACK|Fallback)\b|兜底|降级/,
  },
]

/**
 * Patterns checked against `media/ui/**`. Tighter scope than the
 * extension bundle because overlay carries Tauri-specific defaults
 * that are inert under the webview's transport hijack.
 */
const MEDIA_UI_PATTERNS: Array<{
  description: string
  pattern: RegExp
}> = [
  {
    description: "live process.env read of OPENCORVUS_DEV_* in webview asset",
    pattern: /process\s*\.\s*env\s*(?:\.\s*OPENCORVUS_DEV_[A-Z_]+|\[\s*["']OPENCORVUS_DEV_[A-Z_]+["']\s*\])/,
  },
]

function scanFile(file: string, patterns: typeof FORBIDDEN_BUNDLE): Violation[] {
  const text = fs.readFileSync(file, "utf8")
  const out: Violation[] = []
  for (const { description, pattern } of patterns) {
    const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g")
    const matches = text.match(re) ?? []
    if (matches.length > 0) {
      out.push({ file, pattern: description, matches: matches.slice(0, 5) })
    }
  }
  return out
}

interface AuditOptions {
  bundlePath?: string
  mediaUiDir?: string
  /** Override extension-bundle patterns (used by tests). */
  bundlePatterns?: typeof FORBIDDEN_BUNDLE
  /** Override media/ui patterns (used by tests). */
  mediaUiPatterns?: typeof MEDIA_UI_PATTERNS
}

export interface AuditResult {
  violations: Violation[]
  filesScanned: string[]
}

export function runAudit(opts: AuditOptions = {}): AuditResult {
  const bundlePath = opts.bundlePath ?? path.join(extensionRoot, "dist", "extension.cjs")
  const mediaUiDir = opts.mediaUiDir ?? path.join(extensionRoot, "media", "ui")
  const bundlePatterns = opts.bundlePatterns ?? FORBIDDEN_BUNDLE
  const mediaUiPatterns = opts.mediaUiPatterns ?? MEDIA_UI_PATTERNS
  const violations: Violation[] = []
  const scanned: string[] = []

  if (fs.existsSync(bundlePath)) {
    scanned.push(bundlePath)
    violations.push(...scanFile(bundlePath, bundlePatterns))
  }
  if (fs.existsSync(mediaUiDir)) {
    walkFiles(mediaUiDir, (file) => {
      if (!/\.(html|js|css|json)$/i.test(file)) return
      scanned.push(file)
      violations.push(...scanFile(file, mediaUiPatterns))
    })
  }
  return { violations, filesScanned: scanned }
}

function walkFiles(dir: string, visit: (file: string) => void): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walkFiles(full, visit)
    else if (entry.isFile()) visit(full)
  }
}

if (import.meta.main) {
  const { violations, filesScanned } = runAudit()
  console.log(`[audit-bundle] scanned ${filesScanned.length} file(s)`)
  if (violations.length === 0) {
    console.log("[audit-bundle] OK — no forbidden patterns found")
    process.exit(0)
  }
  console.error(`[audit-bundle] FAIL — ${violations.length} violation(s):`)
  for (const v of violations) {
    console.error(`  ${path.relative(extensionRoot, v.file)}: ${v.pattern}`)
    for (const m of v.matches) console.error(`    match: ${m}`)
  }
  process.exit(1)
}

// Re-export the patterns so tests can assert specific entries exist
// without having to reach for a private name.
export { FORBIDDEN_BUNDLE, MEDIA_UI_PATTERNS }
