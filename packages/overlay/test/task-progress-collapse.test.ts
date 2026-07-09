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
    expect(bundle).toContain('"progress.move_window"')
    expect(bundle).toContain('"progress.resize_window"')
    expect(bundle).toContain('"progress.count.passed"')
    expect(bundle).toContain('"progress.count.running"')
    expect(bundle).toContain('"progress.count.failed"')
    expect(bundle).toContain('"progress.count.pending"')
  }
})

test("TaskProgressBar is a bounded floating window in the message panel", () => {
  expect(source).toContain("interface TaskProgressBarProps")
  expect(source).toContain("overlayMount: HTMLElement")
  expect(source).toContain("taskProgressFloatingBounds")
  expect(source).toContain("initialTaskProgressFloatingFrame")
  expect(source).toContain("moveTaskProgressFloatingFrame")
  expect(source).toContain("resizeTaskProgressFloatingFrame")
  expect(source).toContain("props.overlayMount.clientWidth")
  expect(source).not.toContain("messagePanel")
  expect(source).toContain('"--task-progress-left": `${frame.x}px`')
  expect(source).toContain("setPointerCapture")
  expect(source).toContain("releasePointerCapture")
  expect(source).toContain('data-ui="task-progress-drag-handle"')
  expect(source).toContain('data-ui="task-progress-resize"')
  expect(source).not.toContain("localStorage")
  expect(css).toMatch(/\.task-progress\s*\{[^}]*position:\s*absolute;[^}]*height:\s*auto;[^}]*max-height:\s*var\(--task-progress-height\);/s)
  expect(css).toMatch(/\.task-progress\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--card-bg-1\) 88%, transparent\);/s)
  expect(css).toMatch(/\.task-progress\s*\{[^}]*-webkit-backdrop-filter:\s*blur\(calc\(10px \* var\(--ui-scale\)\)\) saturate\(118%\);/s)
  expect(css).toMatch(/\.task-progress\s*\{[^}]*backdrop-filter:\s*blur\(calc\(10px \* var\(--ui-scale\)\)\) saturate\(118%\);/s)
  expect(css).toMatch(/\.task-progress\s*\{[^}]*box-shadow:\s*var\(--shadow\), inset 0 var\(--oc-border-width\) 0/s)
  expect(css).toContain(".task-progress[data-window-state=\"dragging\"]")
  expect(css).toContain(".task-progress .oc-button[data-ui=\"task-progress-resize\"]")
})

test("TaskProgressBar is the single conversation goal progress surface", () => {
  expect(conversationSource).toContain('const [progressOverlayMount, setProgressOverlayMount] = createSignal<HTMLElement | null>(null)')
  expect(conversationSource).toContain('progressMount.classList.contains("conversation-body")')
  expect(conversationSource).toContain("setProgressOverlayMount(progressMount)")
  expect(conversationSource).toContain("<Portal mount={mount}>")
  expect(conversationSource).toContain("<TaskProgressBar overlayMount={mount} />")
  expect(conversationSource).not.toContain("<TaskProgressBar />")
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
    /\.task-progress \.oc-button\[data-ui="task-progress-pill"\]:hover,\s*\.task-progress \.oc-button\[data-ui="task-progress-pill"\]:focus-visible,\s*\.task-progress \.oc-button\[data-ui="task-progress-pill"\]\[data-hot="true"\]\s*\{[^}]*--oc-button-bg:\s*var\(--card-bg-hover\);[^}]*--oc-button-border:\s*var\(--oc-border-width\) solid var\(--card-border-strong\);[^}]*--oc-button-color:\s*var\(--text-strong\);/s,
  )
  expect(buttonCss).toMatch(
    /\.oc-button:focus-visible\s*\{[^}]*outline:\s*var\(--oc-border-width\) solid var\(--accent\);/s,
  )
  expect(css).not.toMatch(/\.task-progress__(?:fold|pill|toggle)(?:\s|:|\[|\{)/)
})

test("TaskProgressBar renders segmented minimap, header counts, and icon-led compact pills", () => {
  expect(source).toContain("const [hotGoalID, setHotGoalID] = createSignal(\"\")")
  expect(source).toContain('data-ui="task-progress-segment"')
  expect(source).toContain('data-hot={hotGoalID() === g.goalID ? "true" : undefined}')
  expect(source.match(/onMouseEnter=\{\(\) => setHotGoalID\(g\.goalID\)\}/g)?.length).toBe(2)
  expect(source.match(/onMouseLeave=\{\(\) => setHotGoalID\(""\)\}/g)?.length).toBe(2)
  expect(source).toContain('class="task-progress__counts"')
  expect(source).toContain('t("progress.count.passed"')
  expect(source).toContain('t("progress.count.running"')
  expect(source).toContain('t("progress.count.failed"')
  expect(source).toContain('t("progress.count.pending"')
  expect(source).toContain('class="task-progress__pill-icon"')
  expect(source).toContain("<Icon name={goalStateIconName(g.state)} size={12} />")
  expect(source).toContain("goalCompactLabelFromIndexes(g.index, g.attempt)")
  expect(source).not.toContain("goalRevisionLabelFromIndexes(g.index, g.attempt)")
  expect(source).not.toContain("task-progress__bar-fill")
  expect(source).not.toContain("task-progress__bar-fail")
  expect(source).not.toContain('Icon name="maximize"')
})

test("TaskProgressBar visual CSS locks in the redesign invariants", () => {
  expect(css).toMatch(
    /\.task-progress__pills\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(auto-fill, minmax\(calc\(168px \* var\(--ui-scale, 1\)\), 1fr\)\);/s,
  )
  expect(css).toContain(".task-progress__segment")
  expect(css).toContain('.task-progress__segment[data-state="passed"]')
  expect(css).toContain('.task-progress__segment[data-state="failed"]')
  expect(css).toContain('.task-progress__segment[data-state="running"]')
  expect(css).toContain('.task-progress__segment[data-state="pending"]')
  expect(css).toContain('.task-progress__segment[data-hot="true"]')
  expect(css).toContain(".task-progress__pill-icon")
  expect(css).toContain('data-state="running"] .task-progress__pill-icon > svg')
  expect(css).toContain("@media (prefers-reduced-motion: reduce)")
  expect(css).toMatch(
    /\.task-progress \.oc-button\[data-ui="task-progress-resize"\]\s*\{[^}]*--oc-button-bg:\s*transparent;[^}]*--oc-button-border:\s*0 solid transparent;[^}]*background-image:\s*linear-gradient/s,
  )
  expect(css).toMatch(/\.task-progress \.oc-button\[data-ui="task-progress-resize"\]\s*\{[^}]*cursor:\s*ew-resize;/s)
  expect(conversationCss).toMatch(/\.conversation-body\s*\{[^}]*position:\s*relative;/s)
  expect(css).toMatch(
    /\.task-progress:hover \.oc-button\[data-ui="task-progress-resize"\],\s*\.task-progress:focus-within \.oc-button\[data-ui="task-progress-resize"\],\s*\.task-progress\[data-window-state="resizing"\] \.oc-button\[data-ui="task-progress-resize"\]\s*\{[^}]*opacity:\s*var\(--ui-opacity-subtle\);/s,
  )
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
