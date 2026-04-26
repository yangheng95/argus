#!/usr/bin/env bun
import path from "node:path"
import fs from "node:fs"

const ROOT = path.resolve(import.meta.dir, "..", "..")
const ROUTES_DIR = path.join(ROOT, "src", "server", "routes")

type Rule = {
  name: string
  description: string
  match: (line: string, file: string) => boolean
}

const RULES: Rule[] = [
  {
    name: "no-database-use",
    description: "routes/ must not call Database.use(...) directly — use a service-layer function instead",
    match: (line) => /\bDatabase\.use\s*\(/.test(line),
  },
  {
    name: "no-storage-db-import",
    description:
      "routes/ must not import from @/storage/db or ../storage/db except for the NotFoundError type",
    match: (line) => {
      if (!/from\s+["'](@\/storage\/db|\.\.\/+storage\/db)["']/.test(line)) return false
      // Allow imports that only pull NotFoundError (a typed error class).
      const importMatch = line.match(/import\s+\{\s*([^}]+)\s*\}\s+from/)
      if (!importMatch) return true
      const names = importMatch[1].split(",").map((s) => s.trim()).filter(Boolean)
      return names.some((n) => n !== "NotFoundError" && n !== "type NotFoundError")
    },
  },
  {
    name: "no-sql-import",
    description: "routes/ must not import from any */sql module — SQL belongs to the service layer",
    match: (line) => /from\s+["'][^"']*\.sql["']/.test(line) || /from\s+["']@\/[^"']*\/[^"']*\.sql["']/.test(line),
  },
  {
    name: "no-process-env",
    description:
      "routes/ must not read or write process.env — use Flag, Env.snapshot(), or a service-layer helper",
    match: (line) => /\bprocess\.env\b/.test(line),
  },
  {
    name: "no-z-any",
    description: "routes/ must not use z.any() — use z.unknown() for opaque payloads or a named schema",
    match: (line) => /\bz\.any\s*\(/.test(line),
  },
  {
    name: "no-event-type-if-chain",
    description:
      "routes/ must not branch on event-type strings via if-chains — register a handler map at the orchestrator layer",
    match: (line) => /^\s*if\s*\(\s*\w+\s*===\s*\w+\.\w+\.\w+\.type\s*\)/.test(line),
  },
]

type Violation = {
  file: string
  line: number
  rule: string
  text: string
}

function listFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listFiles(p))
    else if (entry.isFile() && (p.endsWith(".ts") || p.endsWith(".tsx"))) out.push(p)
  }
  return out
}

function scan(): Violation[] {
  const violations: Violation[] = []
  for (const file of listFiles(ROUTES_DIR)) {
    const content = fs.readFileSync(file, "utf8")
    const lines = content.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (line.trim().startsWith("//")) continue
      for (const rule of RULES) {
        if (rule.match(line, file)) {
          violations.push({ file, line: i + 1, rule: rule.name, text: line.trim() })
        }
      }
    }
  }
  return violations
}

const violations = scan()
if (violations.length === 0) {
  console.log(`api:routes-check ok — ${RULES.length} rules clean across ${listFiles(ROUTES_DIR).length} files`)
  process.exit(0)
}

console.error(`api:routes-check found ${violations.length} violation(s):\n`)
for (const v of violations) {
  const rel = path.relative(ROOT, v.file).replace(/\\/g, "/")
  console.error(`  ${rel}:${v.line}  [${v.rule}]`)
  console.error(`    ${v.text}`)
}
console.error("")
console.error("Rules:")
for (const rule of RULES) {
  console.error(`  - ${rule.name}: ${rule.description}`)
}
process.exit(1)
