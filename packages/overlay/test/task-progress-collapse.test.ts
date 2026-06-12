import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const source = readFileSync(join(import.meta.dir, "../src/components/TaskProgressBar.tsx"), "utf8")
const css = readFileSync(join(import.meta.dir, "../src/styles/surfaces/card.css"), "utf8")
const en = readFileSync(join(import.meta.dir, "../src/i18n/en-US.json"), "utf8")
const zh = readFileSync(join(import.meta.dir, "../src/i18n/zh-CN.json"), "utf8")

test("TaskProgressBar exposes a whole-card fold control", () => {
  expect(source).toContain("const [folded, setFolded] = createSignal(false)")
  expect(source).toContain('data-folded={folded() ? "true" : "false"}')
  expect(source).toContain('class="task-progress__fold"')
  expect(source).toContain('aria-controls="taskProgressPills"')
  expect(source).toContain('aria-expanded={folded() ? "false" : "true"}')
  expect(source).toContain("onClick={() => setFolded((value) => !value)}")
  expect(source).toContain('Icon name={folded() ? "chevron-down" : "chevron-up"}')
})

test("folded task progress hides only the goal details below the progress bar", () => {
  expect(source).toContain('id="taskProgressPills"')
  expect(css).toContain(".task-progress__fold")
  expect(css).toMatch(
    /\.task-progress\[data-folded="true"\] \.task-progress__pills,\s*\.task-progress\[data-folded="true"\] \.task-progress__toggle\s*\{[^}]*display:\s*none/,
  )
  expect(css).toContain(".task-progress__bar")
})

test("task progress fold labels are localized", () => {
  for (const bundle of [en, zh]) {
    expect(bundle).toContain('"progress.expand_card"')
    expect(bundle).toContain('"progress.collapse_card"')
  }
})
