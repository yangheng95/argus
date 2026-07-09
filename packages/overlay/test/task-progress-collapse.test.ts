import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const source = readFileSync(join(import.meta.dir, "../src/components/TaskProgressBar.tsx"), "utf8")
const conversationSource = readFileSync(join(import.meta.dir, "../src/components/Conversation.tsx"), "utf8")
const html = readFileSync(join(import.meta.dir, "../src/index.html"), "utf8")
const domSource = readFileSync(join(import.meta.dir, "../src/dom.ts"), "utf8")
const conversationCss = readFileSync(join(import.meta.dir, "../src/styles/surfaces/conversation.css"), "utf8")
const css = readFileSync(join(import.meta.dir, "../src/styles/surfaces/card.css"), "utf8")
const buttonCss = readFileSync(join(import.meta.dir, "../src/styles/primitives/button.css"), "utf8")
const en = readFileSync(join(import.meta.dir, "../src/i18n/en-US.json"), "utf8")
const zh = readFileSync(join(import.meta.dir, "../src/i18n/zh-CN.json"), "utf8")

test("TaskProgressBar exposes a whole-card fold control", () => {
  expect(source).toContain("const [folded, setFolded] = createSignal(false)")
  expect(source).toContain('data-folded={folded() ? "true" : "false"}')
  expect(source).toContain('import { Button } from "./ui/Button"')
  expect(source).toContain('data-ui="task-progress-fold"')
  expect(source).toContain('aria-controls="taskProgressPills"')
  expect(source).toContain('aria-expanded={folded() ? "false" : "true"}')
  expect(source).toContain("onClick={() => setFolded((value) => !value)}")
  expect(source).toContain('Icon name={folded() ? "chevron-down" : "chevron-up"}')
  expect(source).not.toContain("<button")
  expect(source).not.toContain('class="task-progress__fold"')
})

test("folded task progress hides only the goal details below the progress bar", () => {
  expect(source).toContain('id="taskProgressPills"')
  expect(css).toContain('.task-progress .oc-button[data-ui="task-progress-fold"]')
  expect(css).toMatch(
    /\.task-progress\[data-folded="true"\] \.task-progress__pills,\s*\.task-progress\[data-folded="true"\] \.oc-button\[data-ui="task-progress-toggle"\]\s*\{[^}]*display:\s*none/,
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
  expect(css).toContain('.task-progress .oc-button[data-ui="task-progress-pill"]')
  for (const sourceText of [html, domSource, conversationCss]) {
    expect(sourceText).not.toMatch(/\bchatGoalsStrip\b/)
    expect(sourceText).not.toMatch(/\bchat-goals-strip\b/)
    expect(sourceText).not.toMatch(/\bgoal-chip\b/)
  }
})

test("TaskProgressBar goal pills expose visible keyboard focus", () => {
  expect(source).toContain('data-ui="task-progress-pill"')
  expect(source).toContain('[data-ui="task-progress-pill"]')
  expect(source).not.toContain('class="task-progress__pill"')
  expect(source).toContain("onClick={() => onPillClick(g.goalID)}")
  expect(css).toMatch(
    /\.task-progress \.oc-button\[data-ui="task-progress-pill"\]:hover,\s*\.task-progress \.oc-button\[data-ui="task-progress-pill"\]:focus-visible\s*\{[^}]*--oc-button-bg:\s*var\(--card-bg-hover\);[^}]*--oc-button-border:\s*var\(--oc-border-width\) solid var\(--card-border-strong\);[^}]*--oc-button-color:\s*var\(--text-strong\);/s,
  )
  expect(buttonCss).toMatch(
    /\.oc-button:focus-visible\s*\{[^}]*outline:\s*var\(--oc-border-width\) solid var\(--accent\);/s,
  )
  expect(css).not.toMatch(/\.task-progress__(?:fold|pill|toggle)(?:\s|:|\[|\{)/)
})

test("TaskProgressBar goal pill locate materializes historical build sessions before scrolling", () => {
  expect(source).toContain("buildSessionIDForGoal")
  expect(source).toContain("conversationAgentRecordsForSource(boardStore.selectedSource)")
  expect(source).toContain("loadConversationHistoryUntilCard")
  expect(source).toContain("loadConversationSessionHistory")
  expect(source).toContain("conversationCardContainsMessage")
  expect(source).toContain("materializeGoalCard")
  expect(source).toContain("setCardExpanded(cardID, true")
  expect(source).toContain("parentIDChainForCard")
  expect(source).toContain("notifyWarning")
  expect(source).toContain('data-goal-id={g.goalID}')
  expect(source).toContain('data-loading={locatingGoalID() === g.goalID ? "true" : undefined}')
  expect(source).toContain('highlight: true')
  expect(source).not.toContain("if (!cardID) return")
  expect(source).not.toContain("console.error(\"[task-progress] goal card scroll request failed\"")
})
