import { expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const STYLES_ROOT = join(import.meta.dir, "..", "src", "styles")

const RUNTIME_STYLE_VARS = new Set([
  "--card-sticky-inline-size",
  "--center-workbench-panel-grow",
  "--conversation-agent-rail-height",
  "--dialog-drag-x",
  "--dialog-drag-y",
  "--image-preview-rendered-height",
  "--image-preview-rendered-width",
  "--pct",
  "--progress-failed",
  "--progress-passed",
  "--titlebar-menu-anchor-left",
  "--todo-progress",
])

function walkCss(root: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(root)) {
    const full = join(root, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) out.push(...walkCss(full))
    else if (entry.endsWith(".css")) out.push(full)
  }
  return out
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "")
}

test("surface CSS only references defined design tokens or explicit runtime style vars", () => {
  const files = walkCss(STYLES_ROOT)
  const definitions = new Set<string>()
  const usages = new Map<string, string[]>()

  for (const file of files) {
    const css = stripComments(readFileSync(file, "utf8"))

    for (const match of css.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) {
      definitions.add(match[1]!)
    }

    for (const [index, line] of css.split(/\r?\n/).entries()) {
      for (const match of line.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)) {
        const token = match[1]!
        const refs = usages.get(token) ?? []
        refs.push(`${relative(STYLES_ROOT, file).replace(/\\/g, "/")}:${index + 1}: ${line.trim()}`)
        usages.set(token, refs)
      }
    }
  }

  const offenders = [...usages.entries()]
    .filter(([token]) => !definitions.has(token) && !RUNTIME_STYLE_VARS.has(token))
    .flatMap(([token, refs]) => refs.map((ref) => `${token} -> ${ref}`))

  expect(offenders).toEqual([])
})
