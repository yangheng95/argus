#!/usr/bin/env bun

import { createHash } from "node:crypto"
import { readdirSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

// ── Panel files for revision hash ──
// Only top-level .html and .js files in src/ are hashed. This keeps the
// revision stable: it changes only when the HTML panel structure changes,
// not when every TypeScript component is edited.
const panel = readdirSync(path.join(dir, "src"))
  .filter((file) => /\.(?:html|js)$/.test(file))
  .map((file) => path.join(dir, "src", file))
  .sort()

// ── Source files for key-usage scanning ──
// Scan all .html, .js, .ts, .tsx files in src/ recursively so that
// i18n keys used by Solid components are recognised as "used".
function collectSourceFiles(base: string): string[] {
  const result: string[] = []
  for (const entry of readdirSync(base)) {
    const full = path.join(base, entry)
    if (statSync(full).isDirectory()) {
      result.push(...collectSourceFiles(full))
    } else if (/\.(?:html|[jt]sx?)$/.test(entry)) {
      result.push(full)
    }
  }
  return result
}
const sourceFiles = collectSourceFiles(path.join(dir, "src")).sort()

const locale = ["en-US", "zh-CN"].map((lang) => path.join(dir, "src", "i18n", `${lang}.json`))

function record(input: unknown): input is Record<string, unknown> {
  return !!input && typeof input === "object" && !Array.isArray(input)
}

function flatten(input: unknown, prefix = "") {
  if (!record(input)) return []
  return Object.entries(input).flatMap(([key, value]) => {
    const next = prefix ? `${prefix}.${key}` : key
    if (next.startsWith("_meta")) return []
    if (!record(value)) return [next]
    return [next, ...flatten(value, next)]
  })
}

function extract(text: string) {
  const keys = new Set<string>()
  for (const match of text.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)) {
    keys.add(match[1])
  }
  return [...keys]
}

function callKey(input?: ts.Expression): string[] {
  if (!input) return []
  if (ts.isStringLiteralLike(input) || ts.isNoSubstitutionTemplateLiteral(input)) return [input.text]
  if (ts.isParenthesizedExpression(input)) return callKey(input.expression)
  if (ts.isConditionalExpression(input)) return [...callKey(input.whenTrue), ...callKey(input.whenFalse)]
  return []
}

function callName(input: ts.LeftHandSideExpression) {
  if (ts.isIdentifier(input)) return input.text
  if (ts.isPropertyAccessExpression(input) && ts.isIdentifier(input.name)) return input.name.text
  return ""
}

function functionName(node: ts.Node) {
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.text
  if ((ts.isFunctionExpression(node) || ts.isArrowFunction(node))
    && ts.isVariableDeclaration(node.parent)
    && ts.isIdentifier(node.parent.name)) return node.parent.name.text
  return ""
}

function callParam(input: ts.Expression | undefined, param: string): boolean {
  if (!input) return false
  if (ts.isIdentifier(input)) return input.text === param
  if (ts.isParenthesizedExpression(input)) return callParam(input.expression, param)
  if (ts.isConditionalExpression(input)) return callParam(input.whenTrue, param) || callParam(input.whenFalse, param)
  return false
}

function wrapperNames(source: ts.SourceFile) {
  const names = new Set(["t", "tc", "errorText"])
  let changed = true
  while (changed) {
    changed = false
    const visit = (node: ts.Node) => {
      if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
        const name = functionName(node)
        if (name && !names.has(name) && node.body && node.parameters[0] && ts.isIdentifier(node.parameters[0].name)) {
          const param = node.parameters[0].name.text
          let hit = false
          const scan = (child: ts.Node) => {
            if (hit) return
            if (ts.isCallExpression(child)
              && names.has(callName(child.expression))
              && callParam(child.arguments[0], param)) {
              hit = true
              return
            }
            ts.forEachChild(child, scan)
          }
          scan(node.body)
          if (hit) {
            names.add(name)
            changed = true
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return names
}

function scriptKind(file: string): ts.ScriptKind {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX
  if (file.endsWith(".ts")) return ts.ScriptKind.TS
  return ts.ScriptKind.JS
}

function scriptKeys(file: string, text: string) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind(file))
  const names = wrapperNames(source)
  const keys = new Set<string>()
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const name = callName(node.expression)
      if (names.has(name)) {
        for (const key of callKey(node.arguments[0])) keys.add(key)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return [...keys]
}

function referenced(keys: string[], input: string) {
  return (
    keys.includes(input) ||
    // input is a descendant of a used key (e.g. key="a", input="a.b")
    keys.some((key) => input.startsWith(`${key}.`)) ||
    // input is an ancestor of a used key (e.g. key="a.b.c", input="a.b")
    keys.some((key) => key.startsWith(`${input}.`))
  )
}

// Revision hash: only panel files (index.html)
const panelText = await Promise.all(panel.map((file) => Bun.file(file).text()))
const revision = createHash("sha256")
  .update(panel.map((file, index) => `${path.relative(dir, file)}\n${panelText[index]}`).join("\n\n"))
  .digest("hex")
  .slice(0, 16)

// Key-usage scan: all source files
const sourceText = await Promise.all(sourceFiles.map((file) => Bun.file(file).text()))
const panelKeys = [...new Set(sourceFiles.flatMap((file, index) => {
  const text = sourceText[index]
  if (file.endsWith(".html")) return extract(text)
  return scriptKeys(file, text)
}))].sort()

const docs = await Promise.all(
  locale.map(async (file) => {
    const data = JSON.parse(await Bun.file(file).text())
    if (!record(data)) throw new Error(`Locale file must be an object: ${path.relative(dir, file)}`)
    const meta = data._meta
    if (!record(meta)) throw new Error(`Missing _meta in ${path.relative(dir, file)}`)
    if (meta.panel_revision !== revision) {
      throw new Error(
        [
          `Panel i18n is stale: ${path.relative(dir, file)}`,
          `Expected _meta.panel_revision to be ${revision}`,
          `Panel files: ${panel.map((item) => path.relative(dir, item)).join(", ")}`,
          "Update both en-US.json and zh-CN.json when the panel changes.",
        ].join("\n"),
      )
    }
    return {
      file,
      keys: flatten(data).sort(),
    }
  }),
)

const base = docs[0]
for (const item of docs) {
  const missing = panelKeys.filter((key) => !item.keys.includes(key))
  if (missing.length === 0) continue
  throw new Error(
    [
      `Panel locale coverage is incomplete: ${path.relative(dir, item.file)}`,
      `Referenced keys: ${panelKeys.length}`,
      `Locale keys: ${item.keys.length}`,
      `Missing keys: ${missing.join(", ")}`,
      "Update both en-US.json and zh-CN.json when the panel adds or renames UI strings.",
    ].join("\n"),
  )
}

for (const item of docs) {
  const unused = item.keys.filter((key) => !referenced(panelKeys, key))
  if (unused.length === 0) continue
  throw new Error(
    [
      `Panel locale has unused keys: ${path.relative(dir, item.file)}`,
      `Unused keys: ${unused.join(", ")}`,
      "Remove stale keys when the panel stops referencing them.",
    ].join("\n"),
  )
}

for (const item of docs.slice(1)) {
  const missing = base.keys.filter((key) => !item.keys.includes(key))
  const extra = item.keys.filter((key) => !base.keys.includes(key))
  if (missing.length === 0 && extra.length === 0) continue
  throw new Error(
    [
      "Panel locale keys are out of sync.",
      `${path.relative(dir, base.file)} keys: ${base.keys.length}`,
      `${path.relative(dir, item.file)} keys: ${item.keys.length}`,
      missing.length ? `Missing in ${path.basename(item.file)}: ${missing.join(", ")}` : "",
      extra.length ? `Extra in ${path.basename(item.file)}: ${extra.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  )
}

console.log(`overlay panel i18n ok (${revision})`)
