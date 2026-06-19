/**
 * Coverage for the worktree row + branch pill added to GoalWorkflowGroup.
 *
 * Source-contract style (matches the repo's prevailing pattern — see
 * dialog-service-single-source.test.ts) rather than DOM render. The
 * contract is: per-goal worktree display reads from props.goal, not a
 * global aggregation; relative-path resolution failure hides the row
 * (rule 7 — no fallback to shortPath / absolute path).
 *
 * Plus §6.4 negative guards: enforce that the deleted TaskWorkspaceLine /
 * currentExecutionDirectory / cwd.execution_workspace surfaces stay
 * deleted (regression watermark).
 */

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const OVERLAY_ROOT = join(import.meta.dir, "..")

function readText(rel: string): string {
  return readFileSync(join(OVERLAY_ROOT, rel), "utf8")
}

describe("GoalWorkflowGroup — worktree row contract", () => {
  const source = readText("src/components/GoalWorkflowGroup.tsx")

  test("interface carries per-goal workspaceDir + workspaceBranch", () => {
    expect(source).toContain("workspaceDir?: string")
    expect(source).toContain("workspaceBranch?: string")
  })

  test("folded-state header renders the branch pill", () => {
    expect(source).toContain('class="gwg-branch-pill"')
    expect(source).toContain("props.goal.workspaceBranch")
  })

  test("expanded body renders a capability-gated worktree button keyed to props.goal.workspaceDir", () => {
    expect(source).toContain('getHostTransport().capabilities.nativeCommands["open-path"]')
    expect(source).toContain("when={canOpenWorktreeDirectory}")
    expect(source).toContain('<div class="gwg-worktree"')
    expect(source).toContain("<Button")
    expect(source).toContain('data-ui="goal-worktree-open"')
    expect(source).toContain('variant="ghost"')
    expect(source).toContain('size="mini"')
    expect(source).toContain('tone="neutral"')
    expect(source).toContain("props.goal.workspaceDir")
    expect(source).toContain("openDirectory(props.goal.workspaceDir!)")
  })

  test("worktree row uses relativePathFrom against the active task dir", () => {
    expect(source).toContain('from "../utils/path"')
    expect(source).toContain("relativePathFrom(base, wt)")
    expect(source).toContain("activeDirectory()")
  })

  test("rule 7 — no fallback to shortPath / absolute / hydration placeholder", () => {
    // The worktree row must be hidden when relativePathFrom returns "" — no
    // shortPath() backup, no "…/…/last2" abbreviation, no raw absolute path.
    // Guard on the function-call form so the rationale prose stays free.
    expect(source).not.toMatch(/\bshortPath\s*\(/)
    expect(source).not.toMatch(/from\s+["'][^"']*\bshortPath\b/)
    // The label memo returns "" on failure; the <Show when={worktreeLabel()}>
    // hides the row entirely. Assert that <Show> wraps the worktree button.
    expect(source).toMatch(/<Show when=\{worktreeLabel\(\)\}>[\s\S]*?<Button[\s\S]*?data-ui="goal-worktree-open"/)
  })

  test("parallel-goal isolation — each card reads its own props.goal, no global aggregation", () => {
    // GoalWorkflowList renders GoalWorkflowGroup per goal via <For each>.
    // The worktree row must reference props.goal.workspaceDir, never a
    // module-scoped accessor over boardStore.board.goalWorkflows.
    expect(source).not.toContain("currentExecutionDirectory")
    expect(source).not.toContain("goalStepPriority")
    // The <For> loop must remain the only parallelization site.
    expect(source).toMatch(/<For each=\{props\.goals\}>/)
  })
})

describe("§6.4 source guards — TaskWorkspaceLine surfaces stay deleted", () => {
  test("overlay/src has no TaskWorkspaceLine identifier", () => {
    // Walk the src tree; the component should not be re-introduced.
    const filesWithSymbol = grepOverlaySrc(/TaskWorkspaceLine/)
    expect(filesWithSymbol).toEqual([])
  })

  test("services/workspace.ts no longer exports currentExecutionDirectory or goalStepPriority", () => {
    const ws = readText("src/services/workspace.ts")
    expect(ws).not.toContain("currentExecutionDirectory")
    expect(ws).not.toContain("goalStepPriority")
  })

  test("i18n bundles no longer carry cwd.execution_workspace", () => {
    const zh = readText("src/i18n/zh-CN.json")
    const en = readText("src/i18n/en-US.json")
    expect(zh).not.toContain("cwd.execution_workspace")
    expect(en).not.toContain("cwd.execution_workspace")
  })

  test("index.html no longer carries the legacy TaskWorkspaceLine mount node", () => {
    const html = readText("src/index.html")
    expect(html).not.toContain("solidTaskWorkspaceLineMount")
    expect(html).not.toContain("taskWorkspaceDir")
  })

  test("dom.ts no longer registers a taskWorkspaceDir handle", () => {
    const dom = readText("src/dom.ts")
    expect(dom).not.toContain("taskWorkspaceDir")
  })

  test("CSS no longer carries .task-workspace-row", () => {
    const css = readText("src/styles/surfaces/conversation.css")
    expect(css).not.toContain(".task-workspace-row")
  })

  test("client step payload mirror no longer carries workspaceDir", () => {
    // card-tree.ts:82 used to mirror the wire TaskBoardGoalStepPayload's
    // workspaceDir field. After §6.5 wire collapse this client-side mirror
    // must also be empty — otherwise the type system permits dead state.
    const tree = readText("src/store/card-tree.ts")
    // Inside the StepPayload interface block.
    const block = tree.match(/export interface StepPayload \{[\s\S]*?\n\}/)?.[0] ?? ""
    expect(block).not.toContain("workspaceDir")
  })
})

/** Walk overlay/src/**.{ts,tsx} and return the relative paths whose
 *  contents match `pattern`. Used by the negative guards above. */
function grepOverlaySrc(pattern: RegExp): string[] {
  const fs = require("node:fs") as typeof import("node:fs")
  const path = require("node:path") as typeof import("node:path")
  const root = path.join(OVERLAY_ROOT, "src")
  const hits: string[] = []
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(ts|tsx)$/.test(entry.name)) {
        const text = fs.readFileSync(full, "utf8")
        if (pattern.test(text)) hits.push(path.relative(OVERLAY_ROOT, full))
      }
    }
  }
  walk(root)
  return hits
}
