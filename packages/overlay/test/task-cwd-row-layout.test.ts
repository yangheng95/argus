import { describe, expect, test } from "bun:test"
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"

const STYLES_ROOT = path.resolve(import.meta.dir, "..", "src", "styles")
const OVERLAY_ROOT = path.resolve(import.meta.dir, "..", "src")
const INDEX_HTML = readFileSync(path.join(OVERLAY_ROOT, "index.html"), "utf8")
const APP = readFileSync(path.join(OVERLAY_ROOT, "components", "App.tsx"), "utf8")
const MAIN = readFileSync(path.join(OVERLAY_ROOT, "main.tsx"), "utf8")
const TASK_DIR_BAR = readFileSync(path.join(OVERLAY_ROOT, "components", "TaskDirBar.tsx"), "utf8")
const PROJECT_LEDGER_GROUP = readFileSync(path.join(OVERLAY_ROOT, "components", "ProjectLedgerGroup.tsx"), "utf8")
const WORK_LEDGER = readFileSync(path.join(OVERLAY_ROOT, "components", "WorkLedger.tsx"), "utf8")
const SIDEBAR_STYLES = readFileSync(path.join(OVERLAY_ROOT, "styles", "surfaces", "sidebar.css"), "utf8")
const ACTIVITY_STYLES = readFileSync(path.join(OVERLAY_ROOT, "styles", "surfaces", "activity.css"), "utf8")

function walkCss(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walkCss(full))
    else if (entry.endsWith(".css")) out.push(full)
  }
  return out
}

function stripCssComments(input: string): string {
  return input.replace(/\/\*[\s\S]*?\*\//g, "")
}

const STYLES = stripCssComments(
  walkCss(STYLES_ROOT)
    .map((file) => readFileSync(file, "utf8"))
    .join("\n"),
)

describe("opened project management ownership", () => {
  test("old top cwd project bar is retired instead of hidden", () => {
    expect(INDEX_HTML).not.toContain("solidProjectDirectoryBarMount")
    expect(INDEX_HTML).not.toContain("workbench-project-bar")
    expect(APP).not.toContain("ProjectDirectoryBar")
    expect(TASK_DIR_BAR).not.toContain("export function ProjectDirectoryBar")
    expect(TASK_DIR_BAR).not.toContain("TaskDirContent")
    expect(STYLES).not.toContain(".task-cwd-dropdown")
    expect(STYLES).not.toContain("cwd-recent-trigger")
    expect(STYLES).not.toContain("task-cwd-caret")
  })

  test("Work Ledger project groups manage already-opened projects without cwd switching controls", () => {
    expect(WORK_LEDGER).toContain("ProjectLedgerGroup")
    expect(PROJECT_LEDGER_GROUP).not.toContain("ProjectDirectoryControl")
    expect(PROJECT_LEDGER_GROUP).not.toContain("canUseProjectDirectory")
    expect(PROJECT_LEDGER_GROUP).toContain(
      "const hasProjectActions = () => canCopyProject() || canRenameProject() || canDeleteProject()",
    )
    expect(PROJECT_LEDGER_GROUP).toContain('data-ui="project-group-toggle"')
    expect(PROJECT_LEDGER_GROUP).toContain('data-ui="project-group-copy"')
    expect(PROJECT_LEDGER_GROUP).toContain('data-ui="project-group-rename"')
    expect(PROJECT_LEDGER_GROUP).toContain('data-ui="project-group-delete"')
    expect(PROJECT_LEDGER_GROUP).not.toContain("project-group-directory-control")
    expect(SIDEBAR_STYLES).not.toContain("project-directory-control")
    expect(SIDEBAR_STYLES).not.toContain("project-group-directory-control")
  })

  test("cwd recent/detected-project popup implementation is removed", () => {
    expect(TASK_DIR_BAR).not.toContain("export interface ProjectDirectoryControlProps")
    expect(TASK_DIR_BAR).not.toContain("export function ProjectDirectoryControl")
    expect(TASK_DIR_BAR).not.toContain('import * as Popover from "@kobalte/core/popover"')
    expect(TASK_DIR_BAR).not.toContain("<Popover.Root")
    expect(TASK_DIR_BAR).not.toContain("pathBreadcrumb(dir()")
    expect(TASK_DIR_BAR).not.toContain("loadWorkspaceOnboardingDiscovery")
    expect(TASK_DIR_BAR).not.toContain("browseDirectory")
    expect(TASK_DIR_BAR).not.toContain("setDirectory")
    expect(TASK_DIR_BAR).not.toContain("loadRecentDirectories")
    expect(TASK_DIR_BAR).not.toContain("removeRecentDirectory")
    expect(TASK_DIR_BAR).not.toContain('data-ui="cwd-path-input"')
    expect(TASK_DIR_BAR).not.toContain('data-ui="recent-dir-edit-submit"')
    expect(TASK_DIR_BAR).not.toContain('data-ui="recent-dir-remove"')
    expect(STYLES).not.toContain("recent-dir-panel")
    expect(STYLES).not.toContain("recent-dir-row")
    expect(STYLES).not.toContain("recent-dir-current-path")
  })
})

describe("project runtime controls in the right toolbar", () => {
  test("right activity toolbar trailing slot owns worktree and git controls", () => {
    expect(MAIN).toContain('import { ProjectRuntimeToolbarActions } from "./components/TaskDirBar"')
    expect(MAIN).toContain("trailing={<ProjectRuntimeToolbarActions />}")
    expect(TASK_DIR_BAR).toContain("export function ProjectRuntimeToolbarActions()")
    expect(TASK_DIR_BAR).toContain("<ProjectWorktreeDropdown compact />")
    expect(TASK_DIR_BAR).toContain("<InitGitButton compact />")
    expect(TASK_DIR_BAR).toContain("<VcsBadge compact />")
    expect(ACTIVITY_STYLES).toContain(".project-runtime-toolbar-actions")
    expect(ACTIVITY_STYLES).toContain('.project-runtime-toolbar-actions .oc-button[data-toolbar-compact="true"]')
    expect(ACTIVITY_STYLES).toContain(".project-runtime-toolbar-actions .vcs-badge-compact")
  })

  test("worktree dropdown keeps the existing Kobalte panel and project worktree API ownership", () => {
    expect(TASK_DIR_BAR).toContain('import * as DropdownMenu from "@kobalte/core/dropdown-menu"')
    expect(TASK_DIR_BAR).toContain("export function ProjectWorktreeDropdown")
    expect(TASK_DIR_BAR).toContain('placement={props.compact ? "left-start" : "bottom-end"}')
    expect(TASK_DIR_BAR).toContain('data-toolbar-compact={props.compact ? "true" : undefined}')
    expect(TASK_DIR_BAR).toContain("loadProjectWorktrees(projectDirectory)")
    expect(TASK_DIR_BAR).toContain("deleteProjectWorktree(projectDirectory, item.directory)")
    expect(TASK_DIR_BAR).toContain("deleteProjectWorktrees(projectDirectory, directories)")
    expect(TASK_DIR_BAR).toContain('data-ui="project-worktree-cleanup-expired"')
    expect(TASK_DIR_BAR).toContain('<DropdownMenu.Content class="project-worktree-panel">')
    expect(TASK_DIR_BAR).toContain("<DropdownMenu.Item")
    expect(TASK_DIR_BAR).toContain("fitViewport")
  })

  test("git init and VCS badge are compact toolbar projections of the existing stores/actions", () => {
    expect(TASK_DIR_BAR).toContain('import { canInitGit, initGitCurrent } from "../utils/git"')
    expect(TASK_DIR_BAR).toContain("const visible = createMemo(() => canInitGit())")
    expect(TASK_DIR_BAR).toContain("await initGitCurrent()")
    expect(TASK_DIR_BAR).toContain('data-ui="project-init-git"')
    expect(TASK_DIR_BAR).toContain('data-toolbar-compact={props.compact ? "true" : undefined}')
    expect(TASK_DIR_BAR).toContain("boardStore.vcs as null")
    expect(TASK_DIR_BAR).toContain('data-ui="project-vcs-badge"')
    expect(TASK_DIR_BAR).toContain('class={props.compact ? "vcs-badge vcs-badge-compact" : "vcs-badge"}')
    expect(TASK_DIR_BAR).toContain("<Show when={!props.compact}>")
  })
})
