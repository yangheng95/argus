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
    expect(TASK_DIR_BAR).toMatch(/<InitGitButton \/>/)
    expect(TASK_DIR_BAR).toMatch(/<VcsBadge \/>/)
    expect(TASK_DIR_BAR).toMatch(/export function ProjectWorktreeDropdown\(\)/)
    expect(TASK_DIR_BAR).toMatch(/export function InitGitButton\(\)/)
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
    expect(TASK_DIR_BAR).toContain('data-ui="project-worktree-remove"')
    expect(TASK_DIR_BAR).toContain('data-chrome="icon-action"')
    expect(TASK_DIR_BAR).toMatch(/<Button[\s\S]*data-ui="project-worktree-remove"/)
    expect(TASK_DIR_BAR).not.toContain('class="project-worktree-remove"')
    expect(TASK_DIR_BAR).toContain('data-kind="active"')
    expect(TASK_DIR_BAR).toContain('data-kind="expired"')
    expect(TASK_DIR_BAR).toContain('t("worktree.active")')
    expect(TASK_DIR_BAR).toContain('t("worktree.expired")')
    expect(TASK_DIR_BAR).toMatch(/<DropdownMenu\.Trigger\s+as=\{Button\}/)
    expect(TASK_DIR_BAR).toContain('<DropdownMenu.Content class="project-worktree-panel">')
    expect(TASK_DIR_BAR).toContain("<DropdownMenu.Item")
    expect(TASK_DIR_BAR).toContain('placement="bottom-end"')
    expect(TASK_DIR_BAR).toContain("fitViewport")
    expect(TASK_DIR_BAR).not.toContain("active_short")
    expect(TASK_DIR_BAR).not.toContain("expired_short")
    expect(TASK_DIR_BAR).toContain(
      'const visibleWorktrees = createMemo(() => worktrees().filter((item) => item.status !== "primary"))',
    )
    expect(TASK_DIR_BAR).toContain("compactPath(item.directory)")
    expect(TASK_DIR_BAR).toContain('compactBranch(item.branch ?? "")')
    expect(TASK_DIR_BAR).toContain("if (!projectDirectory)")
    expect(TASK_DIR_BAR).toContain("loadProjectWorktrees(projectDirectory)")
    expect(TASK_DIR_BAR).toContain("deleteProjectWorktree(dir(), item.directory)")
    expect(TASK_DIR_BAR).not.toContain("const panelMinWidth")
    expect(TASK_DIR_BAR).not.toContain("const panelViewportGap")
    expect(TASK_DIR_BAR).not.toContain("setPanelStyle")
    expect(TASK_DIR_BAR).not.toContain("dropdownRef")
    const row = soloRuleBody(".project-worktree-item")
    expect(row).toMatch(/grid-template-columns:/)
    expect(row).toMatch(/min-height:\s*calc\(28px \* var\(--ui-scale\)\)/)
    const remove = soloRuleBody('.project-worktree-row .oc-button[data-ui="project-worktree-remove"]')
    expect(remove).toMatch(/--oc-button-height:\s*calc\(26px \* var\(--ui-scale\)\)/)
    expect(STYLES).toContain(
      '.project-worktree-row\n  .oc-button[data-size="icon"][data-variant="ghost"][data-chrome="icon-action"][data-ui="project-worktree-remove"]:disabled',
    )
    expect(STYLES).not.toContain(".project-worktree-remove")
    expect(remove).not.toMatch(/outline:\s*none/)
    expect(STYLES).not.toContain(".project-worktree-main")
  })

  test("init git CTA is a compact explicit project action in the cwd row", () => {
    const button = soloRuleBody('.oc-button[data-ui="project-init-git"]')
    expect(button).toMatch(/--oc-button-height:\s*calc\(24px \* var\(--ui-scale\)\)/)
    expect(button).toMatch(/flex-shrink:\s*0/)
    expect(TASK_DIR_BAR).toContain('import { canInitGit, initGitCurrent } from "../utils/git"')
    expect(TASK_DIR_BAR).toContain("const visible = createMemo(() => canInitGit())")
    expect(TASK_DIR_BAR).toContain("await initGitCurrent()")
    expect(TASK_DIR_BAR).toContain('data-ui="project-init-git"')
    expect(TASK_DIR_BAR).toContain('title={t("git.init")}')
    expect(TASK_DIR_BAR).toContain('aria-label={t("git.init")}')
    expect(TASK_DIR_BAR).toContain('<Icon name="github" size={14} />')
    expect(TASK_DIR_BAR.indexOf("<TaskDirContent />")).toBeLessThan(TASK_DIR_BAR.indexOf("<InitGitButton />"))
    expect(TASK_DIR_BAR.indexOf("<InitGitButton />")).toBeLessThan(TASK_DIR_BAR.indexOf("<VcsBadge />"))
    expect(TASK_DIR_BAR).not.toContain("git init")
    const label = soloRuleBody(".project-init-git-label")
    expect(label).toMatch(/text-overflow:\s*ellipsis/)
    expect(label).toMatch(/white-space:\s*nowrap/)
  })

  test("recent directory popup delegates menu semantics and positioning to Kobalte", () => {
    expect(TASK_DIR_BAR).toContain('import * as DropdownMenu from "@kobalte/core/dropdown-menu"')
    expect(TASK_DIR_BAR).toContain("<DropdownMenu.Root")
    expect(TASK_DIR_BAR).toContain("<DropdownMenu.Trigger")
    expect(TASK_DIR_BAR).toContain("<DropdownMenu.Content")
    expect(TASK_DIR_BAR).toContain("<DropdownMenu.Item")
    expect(TASK_DIR_BAR).toContain("sameWidth")
    expect(TASK_DIR_BAR).toContain("fitViewport")
    expect(TASK_DIR_BAR).toContain('class="recent-dir-panel"')
    expect(TASK_DIR_BAR).not.toContain('class="recent-dir-panel" style={panelStyle()} role="listbox"')
  })

  test("recent directory trigger is separate from native breadcrumb path buttons", () => {
    expect(TASK_DIR_BAR).toMatch(/<div[\s\S]*ref=\{cwdShellRef\}[\s\S]*class="task-dir-shell task-cwd-dropdown"/)
    expect(TASK_DIR_BAR).toContain('class="task-dir-menu-actions"')
    expect(TASK_DIR_BAR).toContain('class="task-dir-recent-trigger"')
    expect(TASK_DIR_BAR).toContain('data-ui="cwd-recent-trigger"')
    expect(TASK_DIR_BAR).toContain("getAnchorRect={() => cwdShellRef?.getBoundingClientRect()}")
    expect(TASK_DIR_BAR).not.toContain('as="div"')
    expect(TASK_DIR_BAR).not.toMatch(
      /<DropdownMenu\.Trigger[\s\S]*innerHTML=\{breadcrumbHtml\(\)\}[\s\S]*<\/DropdownMenu\.Trigger>/,
    )
  })

  test("cwd popup owns editable path entry and discovered OpenCorvus projects", () => {
    expect(TASK_DIR_BAR).toContain("loadWorkspaceOnboardingDiscovery")
    expect(TASK_DIR_BAR).toContain('class="recent-dir-edit-form"')
    expect(TASK_DIR_BAR).toContain('data-ui="cwd-path-input"')
    expect(TASK_DIR_BAR).toContain("setPathDraft(event.currentTarget.value)")
    expect(TASK_DIR_BAR).toContain('t("cwd.path_label")')
    expect(TASK_DIR_BAR).toContain('t("cwd.detected_projects")')
    expect(TASK_DIR_BAR).toContain("setDirectory(next)")
    expect(TASK_DIR_BAR).toContain("chooseRecentDirectory(project.directory)")
  })

  test("cwd popup surfaces project discovery failures as a visible state", () => {
    const syncStart = TASK_DIR_BAR.indexOf("async function syncDiscoveredProjects")
    const syncEnd = TASK_DIR_BAR.indexOf("function syncPanelData")
    const syncSource = TASK_DIR_BAR.slice(syncStart, syncEnd)

    expect(syncSource).toContain("loadWorkspaceOnboardingDiscovery")
    expect(syncSource).toContain('discovery.status === "ready"')
    expect(syncSource).toContain("setDiscoveryError(discovery.message)")
    expect(syncSource).not.toContain("catch")
    expect(TASK_DIR_BAR).toContain('data-testid="cwd-discovery-error"')
    expect(TASK_DIR_BAR).toContain('class="recent-dir-discovery-error"')
    expect(TASK_DIR_BAR).toContain('role="status"')
    const error = soloRuleBody(".recent-dir-discovery-error")
    expect(error).toMatch(/grid-template-columns:\s*auto minmax\(0,\s*1fr\)/)
    expect(error).toMatch(/var\(--bad\)/)
    expect(soloRuleBody(".recent-dir-discovery-error span")).toMatch(/overflow-wrap:\s*anywhere/)
  })

  test("cwd popup mirrors current location state onto focusable menu items", () => {
    expect(TASK_DIR_BAR.match(/aria-current=\{isActive\(\) \? "location" : undefined\}/g)?.length).toBe(2)
    expect(TASK_DIR_BAR).toContain('<div class="recent-dir-row" data-active={isActive() ? "true" : "false"}>')
    expect(TASK_DIR_BAR).not.toContain('aria-selected={isActive()')
    expect(TASK_DIR_BAR).not.toContain('aria-pressed={isActive()')
  })

  test("path breadcrumb markup does not nest a second task-dir shell", () => {
    expect(DOM_UTILS).not.toMatch(/<span class="task-dir-shell"/)
    expect(DOM_UTILS).toMatch(/<span class="task-dir-path">/)
  })

  test("path breadcrumb mirrors current location onto the current node", () => {
    expect(DOM_UTILS).toContain('data-current="true" aria-current="location"')
    expect(DOM_UTILS).not.toContain('aria-selected="')
    expect(DOM_UTILS).not.toContain('aria-pressed="')
  })
})
