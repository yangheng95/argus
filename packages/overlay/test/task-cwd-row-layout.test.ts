// Regression for iter34 of the design-language audit.
//
// User feedback (2026-05-03): "把cwd控件改成左/右对齐，调整结构".
//
// Pre-iter34 the task-bar's cwd cluster was a flex column —
// the breadcrumb + caret on row 1, the vcs badge + execution
// workspace label on row 2. Both rows left-aligned. The
// `.task-meta` parent had `justify-content: space-between`
// but only ever had one child (`.task-cwd`), so the
// space-between never actually did anything.
//
// iter34 redesign: keep HTML structure intact (no JSX rewrites
// touching the document-level event delegation that reads
// data-path-action / data-path-set / data-path-open from the
// breadcrumb), but flip `.task-cwd` from column to row so the
// dropdown sits on the left edge and the vcs / workspace info
// sits on the right edge. `space-between` finally does work.
//
// Long paths still ellipsize in the dropdown — `.task-cwd-dropdown`
// gets `flex: 1 1 auto; min-width: 0` so the breadcrumb shrinks
// before the workspace info on the right.

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const RAW = readFileSync(
  path.resolve(import.meta.dir, "..", "src", "styles.css"),
  "utf8",
)
const STYLES = RAW.replace(/\/\*[\s\S]*?\*\//g, "")

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
  })

  test(".task-workspace-row anchors to the right edge with no top margin (single-row layout)", () => {
    const body = soloRuleBody(".task-workspace-row")
    expect(body).not.toMatch(/margin-top:\s*calc\(2px/)
    expect(body).toMatch(/flex-shrink:\s*0/)
  })
})
