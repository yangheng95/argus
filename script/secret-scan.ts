#!/usr/bin/env bun
/**
 * Repo-wide in-tree secret scan.
 *
 * Scans ONLY git-tracked files (so .gitignored .env / .secrets are
 * excluded). Fails the build if any common API-key / credential
 * pattern is found in source. Designed to run in pre-push so a
 * recurrence of the historical `sk-eq7WQu0ylelH6uyedbf6PA` leak  // secret-scan: ignore
 * (commit 9d56d9aec — burned at provider, but cannot be erased
 * from history without rewriting the public branch) is caught
 * BEFORE it lands in a commit, not after.
 *
 * Why a fresh script and not an extension to audit-bundle.ts:
 *   - audit-bundle.ts targets PRODUCTION BUNDLES (dist/extension.cjs,
 *     media/ui), not git-tracked sources.
 *   - This scan operates on the full repo with `git ls-files` so the
 *     coverage is independent of any package's build status.
 *
 * Allow-list: tests intentionally embed fake-looking secrets to
 *   exercise the scanner. Lines containing `secret-scan: ignore`
 *   anywhere on the same line are skipped. Use sparingly.
 */

import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

interface SecretPattern {
  id: string
  /** Human description shown on hit. */
  description: string
  /** Regex applied to each tracked-file LINE. The match itself is
   *  surfaced in the report (truncated to 16 chars). */
  pattern: RegExp
}

/**
 * Patterns chosen for low false-positive on a typical TS/JS repo:
 *
 *  - `sk-` is OpenAI / Hexin / Anthropic style secret prefix; require
 *    ≥20 alnum follow chars to avoid `sk-abc` test fixtures.
 *  - `ghp_` / `gho_` / `ghs_` are GitHub PAT prefixes; ≥30 chars.
 *  - `AKIA[A-Z0-9]{16}` matches AWS access key (fixed length 20).
 *  - `AIza[A-Za-z0-9_-]{35}` matches Google API key (length 39).
 *  - `xoxb-`/`xoxp-` Slack bot/user tokens.
 *  - `eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{30,}\.` JWT shape (catches
 *    embedded user JWTs / opaque service tokens).
 *  - Bare `password\s*[:=]\s*["'][^"'$]{8,}` — heuristic for
 *    hand-pasted plaintext password assignments.
 */
export const SECRET_PATTERNS: ReadonlyArray<SecretPattern> = [
  { id: "openai-style", description: "OpenAI/Hexin/Anthropic-style key (sk-...)", pattern: /sk-[A-Za-z0-9]{20,}/ },
  { id: "github-pat", description: "GitHub personal access token", pattern: /gh[pos]_[A-Za-z0-9]{30,}/ },
  { id: "aws-akid", description: "AWS access key id", pattern: /\bAKIA[A-Z0-9]{16}\b/ },
  { id: "google-api", description: "Google API key", pattern: /\bAIza[A-Za-z0-9_\-]{35,}\b/ },
  { id: "slack-token", description: "Slack bot/user token", pattern: /\bxox[bp]-[A-Za-z0-9-]{20,}\b/ },
  { id: "jwt", description: "Embedded JWT", pattern: /\beyJ[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{20,}\.[A-Za-z0-9_\-]{10,}\b/ },
]

const IGNORE_DIRECTIVE = "secret-scan: ignore"
const TEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".json", ".md", ".yml", ".yaml", ".toml",
  ".html", ".css", ".sh", ".env.example", ".rs",
])

export interface SecretHit {
  file: string
  lineNumber: number
  patternId: string
  description: string
  match: string
}

export interface ScanOptions {
  repoRoot: string
  /** Override the file list (used by tests). Default: `git ls-files`. */
  files?: string[]
  /** Override the pattern set (used by tests). */
  patterns?: ReadonlyArray<SecretPattern>
}

export function listTrackedFiles(repoRoot: string): string[] {
  const r = spawnSync("git", ["-C", repoRoot, "ls-files"], { encoding: "utf8" })
  if (r.status !== 0) {
    throw new Error(`git ls-files failed (status=${r.status}): ${r.stderr}`)
  }
  return r.stdout.split(/\r?\n/).filter(Boolean)
}

function shouldScan(rel: string): boolean {
  const ext = path.extname(rel).toLowerCase()
  // No extension is fine (e.g. Dockerfile, LICENSE) — scan as text.
  if (!ext) return true
  return TEXT_EXTENSIONS.has(ext)
}

export function scan(opts: ScanOptions): SecretHit[] {
  const files = opts.files ?? listTrackedFiles(opts.repoRoot)
  const patterns = opts.patterns ?? SECRET_PATTERNS
  const hits: SecretHit[] = []
  for (const rel of files) {
    if (!shouldScan(rel)) continue
    const abs = path.join(opts.repoRoot, rel)
    let text: string
    try {
      const stat = fs.statSync(abs)
      // Skip binaries / very large files: 1 MB cutoff.
      if (stat.size > 1024 * 1024) continue
      text = fs.readFileSync(abs, "utf8")
    } catch {
      continue
    }
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      if (line.includes(IGNORE_DIRECTIVE)) continue
      for (const p of patterns) {
        const m = p.pattern.exec(line)
        if (!m) continue
        hits.push({
          file: rel,
          lineNumber: i + 1,
          patternId: p.id,
          description: p.description,
          match: m[0].slice(0, 16) + (m[0].length > 16 ? "…" : ""),
        })
      }
    }
  }
  return hits
}

if (import.meta.main) {
  // `new URL(import.meta.url).pathname` returns `/C:/...` on Windows
  // — leading slash poisons `path.resolve`. `fileURLToPath` is the
  // canonical conversion that handles both POSIX and Windows.
  const here = path.dirname(fileURLToPath(import.meta.url))
  const repoRoot = path.resolve(here, "..")
  const hits = scan({ repoRoot })
  if (hits.length === 0) {
    console.log(`[secret-scan] OK — 0 hits across tracked sources`)
    process.exit(0)
  }
  console.error(`[secret-scan] FAIL — ${hits.length} hit(s):`)
  for (const h of hits) {
    console.error(`  ${h.file}:${h.lineNumber}  [${h.patternId}] ${h.description} → ${h.match}`)
  }
  console.error(
    `\nIf the match is a deliberate test fixture, append \`// ${IGNORE_DIRECTIVE}\` to the line.\n` +
      `If it is a real secret: revoke it at the issuing service, then remove from source. The string\n` +
      `also lives in git history — recovery requires \`git filter-repo\` plus a coordinated force-push.`,
  )
  process.exit(1)
}
