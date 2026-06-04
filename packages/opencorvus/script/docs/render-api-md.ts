#!/usr/bin/env bun
import path from "node:path"
import fs from "node:fs"

type GroupCfg = {
  title_en: string
  title_zh: string
  order?: number
  merge_into?: string
}

type I18n = {
  title_en: string
  title_zh: string
  auth_en_lead: string
  auth_zh_lead: string
  generated_lead_en: string
  generated_lead_zh: string
  section_endpoints_en: string
  section_endpoints_zh: string
  method_en: string
  method_zh: string
  path_en: string
  path_zh: string
  summary_en: string
  summary_zh: string
  opid_en: string
  opid_zh: string
  no_summary_en: string
  no_summary_zh: string
  groups: Record<string, GroupCfg>
}

type Op = {
  method: string
  path: string
  operationId: string
  summary?: string
}

type Group = {
  key: string
  title_en: string
  title_zh: string
  order: number
  ops: Op[]
}

const HTTP_METHODS = ["get", "post", "put", "delete", "patch"] as const

const REPO_ROOT = path.resolve(import.meta.dir, "..", "..", "..", "..")
const OPENAPI_PATH = path.join(REPO_ROOT, "packages", "sdk", "openapi.json")
const I18N_PATH = path.join(import.meta.dir, "i18n.json")
const OUT_EN = path.join(REPO_ROOT, "packages", "web", "src", "content", "docs", "reference", "api.mdx")
const OUT_ZH = path.join(REPO_ROOT, "packages", "web", "src", "content", "docs", "zh-cn", "reference", "api.mdx")

function loadJson<T>(p: string): T {
  return JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, "")) as T
}

function firstSegment(p: string): string {
  const trimmed = p.replace(/^\//, "")
  const seg = trimmed.split("/")[0] ?? "misc"
  return seg.toLowerCase()
}

function collectOps(spec: any): Op[] {
  const out: Op[] = []
  for (const [pth, item] of Object.entries(spec.paths ?? {})) {
    for (const m of HTTP_METHODS) {
      const op = (item as any)?.[m]
      if (!op || typeof op !== "object") continue
      if (!op.operationId) continue
      out.push({
        method: m.toUpperCase(),
        path: pth,
        operationId: op.operationId,
        summary: typeof op.summary === "string" ? op.summary : undefined,
      })
    }
  }
  return out
}

function groupOps(ops: Op[], i18n: I18n): Group[] {
  const map = new Map<string, Group>()
  const cfgs = i18n.groups
  for (const op of ops) {
    const seg = firstSegment(op.path)
    let cfg = cfgs[seg]
    let key = seg
    if (cfg?.merge_into) {
      key = cfg.merge_into
      cfg = cfgs[key]
    }
    if (!cfg) {
      cfg = { title_en: capitalize(seg), title_zh: capitalize(seg), order: 9999 }
    }
    let group = map.get(key)
    if (!group) {
      group = {
        key,
        title_en: cfg.title_en,
        title_zh: cfg.title_zh,
        order: cfg.order ?? 9999,
        ops: [],
      }
      map.set(key, group)
    }
    group.ops.push(op)
  }
  for (const g of map.values()) {
    g.ops.sort((a, b) => {
      if (a.path !== b.path) return a.path < b.path ? -1 : 1
      return a.method < b.method ? -1 : 1
    })
  }
  return Array.from(map.values()).sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order
    return a.title_en < b.title_en ? -1 : 1
  })
}

function capitalize(s: string): string {
  if (!s) return s
  return s[0]!.toUpperCase() + s.slice(1)
}

type Lang = "en" | "zh"

function render(groups: Group[], i18n: I18n, lang: Lang): string {
  const isZh = lang === "zh"
  const title = isZh ? i18n.title_zh : i18n.title_en
  const description = isZh
    ? "HTTP API 参考--由 packages/sdk/openapi.json 自动生成。"
    : "HTTP API reference--auto-generated from packages/sdk/openapi.json."
  const generated = isZh ? i18n.generated_lead_zh : i18n.generated_lead_en
  const auth = isZh ? i18n.auth_zh_lead : i18n.auth_en_lead
  const sec = isZh ? i18n.section_endpoints_zh : i18n.section_endpoints_en
  const m = isZh ? i18n.method_zh : i18n.method_en
  const p = isZh ? i18n.path_zh : i18n.path_en
  const sum = isZh ? i18n.summary_zh : i18n.summary_en
  const oid = isZh ? i18n.opid_zh : i18n.opid_en
  const noSummary = isZh ? i18n.no_summary_zh : i18n.no_summary_en

  const lines: string[] = []
  lines.push("---")
  lines.push(`title: ${title}`)
  lines.push(`description: ${JSON.stringify(description)}`)
  lines.push("---")
  lines.push("")
  lines.push(`> ${generated}`)
  lines.push("")
  lines.push(`## Authentication`)
  lines.push("")
  lines.push(auth)
  lines.push("")
  lines.push(`## ${sec}`)
  lines.push("")
  for (const g of groups) {
    const groupTitle = isZh ? g.title_zh : g.title_en
    lines.push(`### ${groupTitle}`)
    lines.push("")
    lines.push(`| ${m} | ${p} | ${sum} | ${oid} |`)
    lines.push(`|---|---|---|---|`)
    for (const op of g.ops) {
      const summary = (op.summary ?? "").trim() || noSummary
      lines.push(`| ${op.method} | \`${op.path}\` | ${escapeCell(summary)} | \`${op.operationId}\` |`)
    }
    lines.push("")
  }
  return lines.join("\n").replace(/\n+$/g, "") + "\n"
}

function escapeCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ")
}

function writeOrCheck(filePath: string, content: string, mode: "write" | "check"): { ok: boolean; diff?: string } {
  if (mode === "write") {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, content, "utf8")
    return { ok: true }
  }
  let onDisk = ""
  try {
    onDisk = fs.readFileSync(filePath, "utf8")
  } catch {
    return { ok: false, diff: `${filePath} does not exist` }
  }
  if (onDisk === content) return { ok: true }
  return {
    ok: false,
    diff: minimalDiff(filePath, onDisk, content),
  }
}

function minimalDiff(label: string, a: string, b: string): string {
  const aLines = a.split("\n")
  const bLines = b.split("\n")
  const max = Math.max(aLines.length, bLines.length)
  const out: string[] = [`--- ${label} (on disk)`, `+++ ${label} (regenerated)`]
  let shown = 0
  for (let i = 0; i < max && shown < 40; i++) {
    if (aLines[i] !== bLines[i]) {
      if (aLines[i] !== undefined) out.push(`-${i + 1}: ${aLines[i]}`)
      if (bLines[i] !== undefined) out.push(`+${i + 1}: ${bLines[i]}`)
      shown++
    }
  }
  if (shown >= 40) out.push("... (truncated, more diffs follow)")
  return out.join("\n")
}

async function main() {
  const args = new Set(process.argv.slice(2))
  const mode: "write" | "check" = args.has("--check") ? "check" : "write"
  const spec = loadJson<any>(OPENAPI_PATH)
  const i18n = loadJson<I18n>(I18N_PATH)
  const ops = collectOps(spec)
  const groups = groupOps(ops, i18n)
  const en = render(groups, i18n, "en")
  const zh = render(groups, i18n, "zh")
  const enRes = writeOrCheck(OUT_EN, en, mode)
  const zhRes = writeOrCheck(OUT_ZH, zh, mode)
  if (mode === "write") {
    console.log(`wrote: ${path.relative(REPO_ROOT, OUT_EN)} (${en.length} bytes, ${ops.length} ops, ${groups.length} groups)`)
    console.log(`wrote: ${path.relative(REPO_ROOT, OUT_ZH)} (${zh.length} bytes)`)
    return
  }
  if (!enRes.ok || !zhRes.ok) {
    if (enRes.diff) console.error(enRes.diff)
    if (zhRes.diff) console.error(zhRes.diff)
    console.error("docs:check failed: regenerated output differs from on-disk markdown")
    process.exit(1)
  }
  console.log(`docs:check ok (${ops.length} ops, ${groups.length} groups)`)
}

await main()
