import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const source = readFileSync(join(import.meta.dir, "../src/components/TaskProgressBar.tsx"), "utf8")
const conversationSource = readFileSync(join(import.meta.dir, "../src/components/Conversation.tsx"), "utf8")
const html = readFileSync(join(import.meta.dir, "../src/index.html"), "utf8")
const domSource = readFileSync(join(import.meta.dir, "../src/dom.ts"), "utf8")
const conversationCss = readFileSync(join(import.meta.dir, "../src/styles/surfaces/conversation.css"), "utf8")
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

test("TaskProgressBar is the single conversation goal progress surface", () => {
  expect(conversationSource).toContain("<TaskProgressBar />")
  expect(css).toContain(".task-progress__pill")
  for (const sourceText of [html, domSource, conversationCss]) {
    expect(sourceText).not.toMatch(/\bchatGoalsStrip\b/)
    expect(sourceText).not.toMatch(/\bchat-goals-strip\b/)
    expect(sourceText).not.toMatch(/\bgoal-chip\b/)
  }
})

test("TaskProgressBar goal pills expose visible keyboard focus", () => {
  expect(source).toContain('class="task-progress__pill"')
  expect(source).toContain("onClick={() => onPillClick(g.goalID)}")
  expect(css).toMatch(
    /\.task-progress__pill:hover\s*\{[^}]*background:\s*var\(--card-bg-hover\);[^}]*border-color:\s*var\(--card-border-strong\);[^}]*color:\s*var\(--text-strong\);/s,
  )
  expect(css).toMatch(
    /\.task-progress__pill:focus-visible\s*\{[^}]*background:\s*var\(--card-bg-hover\);[^}]*border-color:\s*var\(--card-border-strong\);[^}]*color:\s*var\(--text-strong\);[^}]*outline:\s*var\(--oc-border-width\) solid color-mix\(in srgb, var\(--accent\) 40%, transparent\);[^}]*outline-offset:\s*calc\(2px \* var\(--ui-scale\)\);/s,
  )
})
