// Regression for iter34 of the design-language audit.
//
// User feedback (2026-05-03): "把cwd控件改成左/右对齐，调整结构".
//
// Pre-iter34 the task-bar's cwd cluster was a flex column —
// the breadcrumb + caret on row 1, the vcs badge + execution
// workspace label on row 2. Both rows left-aligned.
//
// iter34 redesign: flip `.task-cwd` from column to row so the
// dropdown sits on the left edge and the vcs info sits on the
// right edge.
//
// 2026-06-09: project worktree management returned to this row as a
// compact dropdown. Per-goal worktree detail remains on GoalWorkflowGroup;
// this test covers the cwd row chrome only.

import { describe, expect, test } from "bun:test"
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"

const STYLES_ROOT = path.resolve(import.meta.dir, "..", "src", "styles")
const OVERLAY_ROOT = path.resolve(import.meta.dir, "..", "src")
const INDEX_HTML = readFileSync(path.join(OVERLAY_ROOT, "index.html"), "utf8")
const TASK_DIR_BAR = readFileSync(path.join(OVERLAY_ROOT, "components", "TaskDirBar.tsx"), "utf8")
const DOM_UTILS = readFileSync(path.join(OVERLAY_ROOT, "utils", "dom-utils.ts"), "utf8")

function walkCss(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walkCss(full))
    else if (entry.endsWith(".css")) out.push(full)
  }
  return out
}

// Concatenate all surface + cascade + primitive CSS files (styles.css was
// dissolved 2026-05-04 into this decomposed architecture). Comments are
// stripped first so a /* ... */ block immediately preceding a rule does
// not get folded into the rule's selector head when we split on }.
function stripCssComments(input: string): string {
  return input.replace(/\/\*[\s\S]*?\*\//g, "")
}
const STYLES = stripCssComments(
  walkCss(STYLES_ROOT)
    .map((f) => readFileSync(f, "utf8"))
    .join("\n"),
)

function soloRuleBody(selector: string): string {
  for (const chunk of STYLES.split("}")) {
    const openIdx = chunk.indexOf("{")
    if (openIdx < 0) continue
    const raw = chunk.slice(0, openIdx)
    const head = raw.trim()
    if (head !== selector) continue
    const lastNewline = raw.lastIndexOf("\n")
    const lastLine = raw.slice(lastNewline + 1)
    if (lastLine !== lastLine.trimStart()) continue
    return chunk.slice(openIdx + 1)
  }
  throw new Error(`solo ${selector} not found`)
}

describe("task-cwd cluster lays out left/right (dropdown left, workspace info right)", () => {
  test(".task-cwd is flex row with space-between justification", () => {
    const body = soloRuleBody(".task-cwd")
    expect(body).toMatch(/flex-direction:\s*row/)
    expect(body).toMatch(/justify-content:\s*space-between/)
    expect(body).toMatch(/align-items:\s*center/)
  })

  test(".task-cwd does NOT lay out as a column anymore (the pre-iter34 stack)", () => {
    const body = soloRuleBody(".task-cwd")
    expect(body).not.toMatch(/flex-direction:\s*column/)
  })

  test(".task-cwd-dropdown can shrink so long breadcrumbs ellipsize before pushing the right cluster off-screen", () => {
    const body = soloRuleBody(".task-cwd-dropdown")
    expect(body).toMatch(/flex:\s*1\s+1\s+auto/)
    expect(body).toMatch(/min-width:\s*0/)
    const shell = soloRuleBody(".task-dir-shell")
    expect(shell).toMatch(/box-sizing:\s*border-box/)
    expect(shell).toMatch(/height:\s*calc\(24px \* var\(--ui-scale\)\)/)
  })

  test("project directory bar owns cwd dropdown and branch badge from one Solid mount", () => {
    expect(INDEX_HTML.match(/solidProjectDirectoryBarMount/g)?.length).toBe(1)
    expect(INDEX_HTML).toMatch(/<div id="solidProjectDirectoryBarMount"><\/div>/)
    expect(TASK_DIR_BAR).toMatch(/export function ProjectDirectoryBar\(\)/)
    expect(TASK_DIR_BAR).toMatch(/<TaskDirContent \/>/)
    expect(TASK_DIR_BAR).toMatch(/<ProjectWorktreeDropdown \/>/)
    expect(TASK_DIR_BAR).toMatch(/<VcsBadge \/>/)
    expect(TASK_DIR_BAR).toMatch(/export function ProjectWorktreeDropdown\(\)/)
    expect(TASK_DIR_BAR).toMatch(/export function VcsBadge\(\)/)
    expect(INDEX_HTML).not.toMatch(/solidTaskDirMount/)
    expect(INDEX_HTML).not.toMatch(/solidTaskVcsMount/)
  })

  test("project worktree dropdown is a compact sibling in the cwd row", () => {
    const taskCluster = soloRuleBody(".task-project-cluster")
    expect(taskCluster).toMatch(/display:\s*flex/)
    expect(taskCluster).toMatch(/align-items:\s*center/)
    const button = soloRuleBody('.oc-button[data-ui="project-worktree-dropdown"]')
    expect(button).toMatch(/--oc-button-height:\s*calc\(24px \* var\(--ui-scale\)\)/)
    expect(button).toMatch(/flex-shrink:\s*0/)
    expect(soloRuleBody(".oc-button")).toMatch(/display:\s*inline-flex/)
    expect(TASK_DIR_BAR).toContain('import { Button } from "./ui/Button"')
    expect(TASK_DIR_BAR).toContain('data-ui="project-worktree-dropdown"')
    expect(TASK_DIR_BAR).toContain('size="sm"')
    expect(TASK_DIR_BAR).not.toContain('class="project-worktree-dropdown"')
    expect(TASK_DIR_BAR).toContain('class="project-worktree-panel"')
    expect(TASK_DIR_BAR).toContain('class="project-worktree-remove"')
    expect(TASK_DIR_BAR).toContain('data-kind="active"')
    expect(TASK_DIR_BAR).toContain('data-kind="expired"')
    expect(TASK_DIR_BAR).toContain('t("worktree.active")')
    expect(TASK_DIR_BAR).toContain('t("worktree.expired")')
    expect(TASK_DIR_BAR).not.toContain("active_short")
    expect(TASK_DIR_BAR).not.toContain("expired_short")
    expect(TASK_DIR_BAR).toContain(
      'const visibleWorktrees = createMemo(() => worktrees().filter((item) => item.status !== "primary"))',
    )
    expect(TASK_DIR_BAR).toContain("compactPath(item.directory)")
    expect(TASK_DIR_BAR).toContain('compactBranch(item.branch ?? "")')
    expect(TASK_DIR_BAR).toContain("const panelMinWidth = 340")
    expect(TASK_DIR_BAR).toContain("const panelViewportGap = 4")
    expect(TASK_DIR_BAR).toContain("viewportWidth - panelViewportGap * 2")
    expect(TASK_DIR_BAR).toContain("viewportWidth - width - panelViewportGap")
    const row = soloRuleBody(".project-worktree-item")
    expect(row).toMatch(/grid-template-columns:/)
    expect(row).toMatch(/min-height:\s*calc\(28px \* var\(--ui-scale\)\)/)
    expect(STYLES).not.toContain(".project-worktree-main")
  })

  test("recent directory popup is portalled above page stacking contexts", () => {
    expect(TASK_DIR_BAR).toContain('import { Portal } from "solid-js/web"')
    expect(TASK_DIR_BAR).toContain("<Portal mount={document.body}>")
    expect(TASK_DIR_BAR).toContain('class="recent-dir-panel"')
  })

  test("path breadcrumb markup does not nest a second task-dir shell", () => {
    expect(DOM_UTILS).not.toMatch(/<span class="task-dir-shell"/)
    expect(DOM_UTILS).toMatch(/<span class="task-dir-path">/)
  })
})
