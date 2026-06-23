import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const OVERLAY_ROOT = join(import.meta.dir, "..")

function read(path: string): string {
  return readFileSync(join(OVERLAY_ROOT, path), "utf8")
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(read(path))
}

const PROJECT_LEDGER_GROUP = read("src/components/ProjectLedgerGroup.tsx")
const TASK_LIST = read("src/components/TaskList.tsx")
const MISSION_LIST = read("src/components/MissionList.tsx")
const CODING_ASSISTANT_LIST = read("src/components/CodingAssistantSessionList.tsx")
const WORKSPACE_SERVICE = read("src/services/workspace.ts")
const SIDEBAR_CSS = read("src/styles/surfaces/sidebar.css")

describe("project delete button", () => {
  test("TaskList wires project deletion through ProjectLedgerGroup, not task rows", () => {
    expect(TASK_LIST).toContain('import { deleteProject } from "../services/workspace"')
    expect(TASK_LIST).toContain("async function handleDeleteProject(directory: string)")
    expect(TASK_LIST).toContain("await deleteProject(target)")
    expect(TASK_LIST).toContain("onDeleteProject={handleDeleteProject}")
    expect(TASK_LIST).toContain('data-ui="task-row-delete"')
    expect(TASK_LIST).not.toContain('data-ui="project-group-delete"')
    expect(TASK_LIST).not.toContain('method: "DELETE",\n    })\n    await loadTasks()')
  })

  test("ProjectLedgerGroup owns the project delete primitive beside the disclosure toggle", () => {
    expect(PROJECT_LEDGER_GROUP).toContain('import { ArmedConfirmButton } from "./ui/ArmedConfirmButton"')
    expect(PROJECT_LEDGER_GROUP).toContain("onDeleteProject?: (directory: string) => void | Promise<void>")
    expect(PROJECT_LEDGER_GROUP).toContain('class="project-group-head"')
    expect(PROJECT_LEDGER_GROUP).toContain('data-ui="project-group-toggle"')
    expect(PROJECT_LEDGER_GROUP).toContain('data-ui="project-group-delete"')
    expect(PROJECT_LEDGER_GROUP).toContain("data-project-delete={props.directory}")
    expect(PROJECT_LEDGER_GROUP).toContain('label={t("project.delete_button_title")}')
    expect(PROJECT_LEDGER_GROUP).toContain('armedDescription={t("armed_confirm.project.delete"')
    expect(PROJECT_LEDGER_GROUP).toContain("void props.onDeleteProject?.(props.directory)")
    expect(PROJECT_LEDGER_GROUP).toContain(
      "const canDeleteProject = () => !!props.onDeleteProject && !!props.directory.trim()",
    )
    expect(PROJECT_LEDGER_GROUP).not.toContain("<button")
  })

  test("shared Mission and Coding Assistant project groups do not get project deletion", () => {
    expect(MISSION_LIST).toContain("ProjectLedgerGroup")
    expect(CODING_ASSISTANT_LIST).toContain("ProjectLedgerGroup")
    expect(MISSION_LIST).not.toContain("onDeleteProject")
    expect(CODING_ASSISTANT_LIST).not.toContain("onDeleteProject")
  })

  test("workspace service has a single project-delete API path", () => {
    expect(WORKSPACE_SERVICE).toContain("export async function deleteProject(directory: string)")
    expect(WORKSPACE_SERVICE).toContain('directoryScopedPath("project/current", target, "deleteProject")')
    expect(WORKSPACE_SERVICE).toContain('method: "DELETE"')
    expect(WORKSPACE_SERVICE).toContain("parseDeleteProjectResult")
    expect(WORKSPACE_SERVICE).toContain("removeRecentDirectory(target)")
    expect(WORKSPACE_SERVICE).toContain("if (deletedActive) closeProject()")
    expect(WORKSPACE_SERVICE).not.toContain('directoryScopedPath("task/')
  })

  test("sidebar CSS reserves a stable project-group action slot", () => {
    expect(SIDEBAR_CSS).toMatch(/\.project-group-head\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto;/)
    expect(SIDEBAR_CSS).toContain('.project-group .oc-button[data-ui="project-group-delete"]')
    expect(SIDEBAR_CSS).toContain('.project-group .oc-button[data-ui="project-group-toggle"]')
    expect(SIDEBAR_CSS).toMatch(
      /\.project-group \.oc-button\[data-ui="project-group-toggle"\]\s*\{[^}]*grid-template-columns:\s*calc\(18px \* var\(--ui-scale\)\) minmax\(0, 1fr\) auto calc\(16px \* var\(--ui-scale\)\);/,
    )
    expect(SIDEBAR_CSS).toContain('.project-group-delete-icon[data-icon="confirm"]')
    expect(SIDEBAR_CSS).toContain('.oc-button[data-ui="project-group-delete"][data-confirm="true"]')
  })

  test("project delete strings exist in both locale catalogs", () => {
    const en = readJson("src/i18n/en-US.json")
    const zh = readJson("src/i18n/zh-CN.json")
    for (const key of [
      "armed_confirm.project.delete",
      "project.delete_button_title",
      "project.delete_success_title",
      "project.delete_success",
      "project.delete_failed_title",
      "project.delete_failed",
    ]) {
      expect(Object.hasOwn(en, key)).toBe(true)
      expect(Object.hasOwn(zh, key)).toBe(true)
    }
  })
})
