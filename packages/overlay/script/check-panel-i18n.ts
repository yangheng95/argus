#!/usr/bin/env bun

import { createHash } from "node:crypto"
import path from "node:path"
import { fileURLToPath } from "node:url"

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const panel = ["src/index.html", "src/app.js"].map((file) => path.join(dir, file))
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
  for (const match of text.matchAll(/\b(?:t|tc|errorText)\(\s*["'`]([^"'`]+)["'`]/g)) {
    keys.add(match[1])
  }
  for (const match of text.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g)) {
    keys.add(match[1])
  }
  return [...keys]
}

const panelText = await Promise.all(panel.map((file) => Bun.file(file).text()))
const panelKeys = [...new Set(panelText.flatMap((text) => extract(text)))].sort()
const revision = createHash("sha256")
  .update(panel.map((file, index) => `${path.relative(dir, file)}\n${panelText[index]}`).join("\n\n"))
  .digest("hex")
  .slice(0, 16)

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
