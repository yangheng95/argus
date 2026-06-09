#!/usr/bin/env bun
import path from "node:path"
import fs from "node:fs"
import { Server } from "../../src/server/server"
import { extractSdkRoutesFromText } from "./sdk-route-extractor"

const ROOT = path.resolve(import.meta.dir, "..", "..")
const ROUTES_DIR = path.join(ROOT, "src", "server", "routes")
const SDK_OPENAPI = path.resolve(ROOT, "..", "sdk", "openapi.json")
const SDK_TS = path.resolve(ROOT, "..", "sdk", "js", "src", "gen", "sdk.gen.ts")
const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"])
const OPENAPI_METHODS = new Set(["get", "post", "put", "patch", "delete"])
const RAW_RUNTIME_ROUTES_WITHOUT_OPENAPI = new Set(["GET /doc", "GET /ui"])

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
    description: "routes/ must not import from @/storage/db or ../storage/db except for the NotFoundError type",
    match: (line) => {
      if (!/from\s+["'](@\/storage\/db|\.\.\/+storage\/db)["']/.test(line)) return false
      // Allow imports that only pull NotFoundError (a typed error class).
      const importMatch = line.match(/import\s+\{\s*([^}]+)\s*\}\s+from/)
      if (!importMatch) return true
      const names = importMatch[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
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
    description: "routes/ must not read or write process.env — use Flag, Env.snapshot(), or a service-layer helper",
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

type InventoryViolation = {
  rule: string
  entries: string[]
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

function normalizeRuntimePath(input: string) {
  const normalized = input.replace(/:([A-Za-z0-9_]+)/g, (_match, name: string) => `{${name}}`).replace(/\/$/, "")
  return normalized || "/"
}

async function runtimeRoutes() {
  const app = (await Server.routeInventoryApp()) as unknown as {
    routes: Array<{ method: string; path: string }>
  }
  const routes = new Set<string>()
  for (const route of app.routes) {
    if (!HTTP_METHODS.has(route.method)) continue
    if (route.path.includes("*")) continue
    const entry = `${route.method} ${normalizeRuntimePath(route.path)}`
    if (RAW_RUNTIME_ROUTES_WITHOUT_OPENAPI.has(entry)) continue
    routes.add(entry)
  }
  return routes
}

function openapiRoutes(spec: { paths?: Record<string, Record<string, unknown>> }) {
  const routes = new Set<string>()
  for (const [routePath, operations] of Object.entries(spec.paths ?? {})) {
    for (const method of Object.keys(operations)) {
      if (!OPENAPI_METHODS.has(method)) continue
      routes.add(`${method.toUpperCase()} ${routePath}`)
    }
  }
  return routes
}

function sdkRoutes() {
  const text = fs.readFileSync(SDK_TS, "utf8")
  return extractSdkRoutesFromText(text)
}

function difference(left: Set<string>, right: Set<string>) {
  return [...left].filter((entry) => !right.has(entry)).sort()
}

function readJsonFile(pathname: string) {
  const text = fs.readFileSync(pathname, "utf8").replace(/^\uFEFF/, "")
  return JSON.parse(text) as unknown
}

async function scanInventory(): Promise<InventoryViolation[]> {
  const generated = await Server.openapi()
  const tracked = readJsonFile(SDK_OPENAPI) as {
    paths?: Record<string, Record<string, unknown>>
  }
  const runtime = await runtimeRoutes()
  const generatedOpenapi = openapiRoutes(generated)
  const trackedOpenapi = openapiRoutes(tracked)
  const generatedSdk = sdkRoutes()

  return [
    {
      rule: "runtime-route-missing-openapi",
      entries: difference(runtime, generatedOpenapi),
    },
    {
      rule: "openapi-route-missing-runtime",
      entries: difference(generatedOpenapi, runtime),
    },
    {
      rule: "generated-openapi-missing-tracked-openapi",
      entries: difference(generatedOpenapi, trackedOpenapi),
    },
    {
      rule: "tracked-openapi-missing-generated-openapi",
      entries: difference(trackedOpenapi, generatedOpenapi),
    },
    {
      rule: "openapi-route-missing-sdk",
      entries: difference(trackedOpenapi, generatedSdk),
    },
    {
      rule: "sdk-route-missing-openapi",
      entries: difference(generatedSdk, trackedOpenapi),
    },
  ].filter((violation) => violation.entries.length > 0)
}

const violations = scan()
const inventoryViolations = await scanInventory()
if (violations.length === 0 && inventoryViolations.length === 0) {
  console.log(
    `api:routes-check ok — ${RULES.length} rules and route inventory clean across ${listFiles(ROUTES_DIR).length} files`,
  )
  process.exit(0)
}

if (violations.length > 0) {
  console.error(`api:routes-check found ${violations.length} static violation(s):\n`)
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
}

if (inventoryViolations.length > 0) {
  console.error(`api:routes-check found ${inventoryViolations.length} route inventory violation(s):\n`)
  for (const violation of inventoryViolations) {
    console.error(`  [${violation.rule}]`)
    for (const entry of violation.entries) console.error(`    ${entry}`)
  }
}
process.exit(1)
