import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const TASK_LIST_SOURCE = readFileSync(join(import.meta.dir, "../src/components/TaskList.tsx"), "utf8")
const TASK_ROW_ACTIONS_KEYBOARD_SOURCE = readFileSync(
  join(import.meta.dir, "../src/components/useTaskRowActionsKeyboard.ts"),
  "utf8",
)
const LEDGER_ROW_MAIN_BUTTON_SOURCE = readFileSync(
  join(import.meta.dir, "../src/components/LedgerRowMainButton.tsx"),
  "utf8",
)
const ARMED_CONFIRM_BUTTON_SOURCE = readFileSync(
  join(import.meta.dir, "../src/components/ui/ArmedConfirmButton.tsx"),
  "utf8",
)
const PROJECT_LEDGER_GROUP_SOURCE = readFileSync(
  join(import.meta.dir, "../src/components/ProjectLedgerGroup.tsx"),
  "utf8",
)
const SIDEBAR_CSS = readFileSync(join(import.meta.dir, "../src/styles/surfaces/sidebar.css"), "utf8")

test("TaskList sidebar controls route through the Button primitive", () => {
  expect(TASK_LIST_SOURCE).toMatch(/import \{ Button \} from "\.\/ui\/Button"/)
  expect(TASK_LIST_SOURCE).toMatch(/import \{ ArmedConfirmButton \} from "\.\/ui\/ArmedConfirmButton"/)
  expect(TASK_LIST_SOURCE).toContain('import { LedgerRowMainButton } from "./LedgerRowMainButton"')
  expect(TASK_LIST_SOURCE).toContain("<LedgerRowMainButton")
  expect(TASK_LIST_SOURCE).toContain("<ArmedConfirmButton")
  expect(TASK_LIST_SOURCE).not.toContain("../solid/armed-confirm")
  expect(TASK_LIST_SOURCE).not.toContain("useArmedConfirm(")
  expect(ARMED_CONFIRM_BUTTON_SOURCE).toContain('import { Button, type ButtonProps } from "./Button"')
  expect(ARMED_CONFIRM_BUTTON_SOURCE).toContain('role="status"')
  expect(ARMED_CONFIRM_BUTTON_SOURCE).toContain('aria-live="polite"')
  expect(TASK_LIST_SOURCE).not.toContain('<button\n            ref={(el) => rowActions.setMainButtonRef(el)}')
  expect(LEDGER_ROW_MAIN_BUTTON_SOURCE).toContain('import { Button } from "./ui/Button"')
  expect(LEDGER_ROW_MAIN_BUTTON_SOURCE).toContain('data-ui="ledger-row-main"')
  expect(LEDGER_ROW_MAIN_BUTTON_SOURCE).toContain('variant="ghost"')
  expect(LEDGER_ROW_MAIN_BUTTON_SOURCE).toContain('size="sm"')
  expect(LEDGER_ROW_MAIN_BUTTON_SOURCE).toContain('tone="neutral"')
  expect(TASK_LIST_SOURCE).toContain('data-ui="task-row-delete"')
  expect(TASK_LIST_SOURCE).toContain('data-ui="task-row-cancel"')
  expect(TASK_LIST_SOURCE).toContain('data-ui="task-row-download"')
  expect(TASK_LIST_SOURCE).toContain('data-ui="task-row-start-now"')
  expect(TASK_LIST_SOURCE).toContain('data-ui="task-row-children-toggle"')
  expect(TASK_LIST_SOURCE).toContain('data-ui="task-list-search-clear"')
  expect(TASK_LIST_SOURCE).toContain('data-ui="task-list-error-retry"')
  expect(TASK_LIST_SOURCE).toContain('import { useTaskRowActionsKeyboard } from "./useTaskRowActionsKeyboard"')
  expect(TASK_LIST_SOURCE).toContain("const rowActions = useTaskRowActionsKeyboard(hasActions)")
  expect(TASK_LIST_SOURCE).toContain('aria-keyshortcuts={hasActions() ? "ArrowRight" : undefined}')
  expect(TASK_LIST_SOURCE).toContain("tabIndex={rowActions.actionButtonTabIndex()}")
  expect(TASK_LIST_SOURCE).not.toContain("const [actionsKeyboardOpen, setActionsKeyboardOpen]")
  expect(TASK_ROW_ACTIONS_KEYBOARD_SOURCE).toContain("function openActionsFromKeyboard")
  expect(TASK_ROW_ACTIONS_KEYBOARD_SOURCE).toContain('event.key !== "ArrowRight"')
  expect(TASK_ROW_ACTIONS_KEYBOARD_SOURCE).toContain('event.key !== "Escape" && event.key !== "ArrowLeft"')
  expect(TASK_ROW_ACTIONS_KEYBOARD_SOURCE).toContain("actionsKeyboardOpenData")
  expect(TASK_LIST_SOURCE).not.toContain('class="task-row-delete"')
  expect(TASK_LIST_SOURCE).not.toContain('class="task-row-cancel"')
  expect(TASK_LIST_SOURCE).not.toContain('class="task-row-export"')
  expect(TASK_LIST_SOURCE).not.toContain('class="task-row-download"')
  expect(TASK_LIST_SOURCE).not.toContain('class="task-row-start-now"')
  expect(TASK_LIST_SOURCE).not.toContain('class="task-row-children-toggle"')
  expect(TASK_LIST_SOURCE).not.toContain('class="task-list-import-button"')
  expect(TASK_LIST_SOURCE).not.toContain('class="task-list-search-clear"')
  expect(TASK_LIST_SOURCE).not.toContain('class="task-list-error-retry"')
})

test("TaskList no longer exposes task archive import or export actions", () => {
  expect(TASK_LIST_SOURCE).not.toContain("../services/task-archive")
  expect(TASK_LIST_SOURCE).not.toContain("exportTaskArchive")
  expect(TASK_LIST_SOURCE).not.toContain("importTaskArchive")
  expect(TASK_LIST_SOURCE).not.toContain('data-ui="task-row-export"')
  expect(TASK_LIST_SOURCE).not.toContain("data-task-export")
  expect(TASK_LIST_SOURCE).not.toContain('data-ui="task-list-import-button"')
  expect(TASK_LIST_SOURCE).not.toContain("data-task-import")
  expect(TASK_LIST_SOURCE).not.toContain("task-archive:")
  expect(SIDEBAR_CSS).not.toContain("task-row-export")
  expect(SIDEBAR_CSS).not.toContain("task-list-import")
  expect(SIDEBAR_CSS).toContain('data-ui="task-row-download"')
  expect(TASK_LIST_SOURCE).not.toContain("window.alert(")
})

test("TaskList marks tasks with unread notification facts", () => {
  expect(TASK_LIST_SOURCE).toContain("taskHasUnreadNotification")
  expect(TASK_LIST_SOURCE).toContain('data-notification-unread={hasUnreadNotification() ? "true" : undefined}')
})

test("TaskList task rows stay one-line while preserving detail in tooltips", () => {
  expect(TASK_LIST_SOURCE).toContain("taskListFullTip")
  expect(TASK_LIST_SOURCE).toContain("ProjectLedgerGroup")
  expect(TASK_LIST_SOURCE).toContain("createProjectLedgerGroupCollapseState")
  expect(TASK_LIST_SOURCE).toContain("directoryCollapse.toggle(group.directory)")
  expect(TASK_LIST_SOURCE).not.toContain("projectGroupTip")
  expect(TASK_LIST_SOURCE).not.toContain("collapsedDirectories")
  expect(TASK_LIST_SOURCE).not.toContain('class="project-group-heading"')
  expect(TASK_LIST_SOURCE).not.toContain('class="project-group-count"')
  expect(TASK_LIST_SOURCE).not.toContain('class="project-group-chevron"')
  expect(PROJECT_LEDGER_GROUP_SOURCE).toContain('import { Button } from "./ui/Button"')
  expect(PROJECT_LEDGER_GROUP_SOURCE).toContain('data-ui="project-group-toggle"')
  expect(PROJECT_LEDGER_GROUP_SOURCE).toContain('variant="ghost"')
  expect(PROJECT_LEDGER_GROUP_SOURCE).toContain('size="mini"')
  expect(PROJECT_LEDGER_GROUP_SOURCE).toContain('tone="neutral"')
  expect(PROJECT_LEDGER_GROUP_SOURCE).not.toContain("<button")
  expect(PROJECT_LEDGER_GROUP_SOURCE).not.toContain('class="project-group-heading"')
  expect(PROJECT_LEDGER_GROUP_SOURCE).toContain('class="project-group-count"')
  expect(PROJECT_LEDGER_GROUP_SOURCE).toContain('aria-expanded={props.collapsed ? "false" : "true"}')
  expect(PROJECT_LEDGER_GROUP_SOURCE).toContain("aria-controls={props.collapsed ? undefined : bodyElementID()}")
  expect(PROJECT_LEDGER_GROUP_SOURCE).toContain('id={bodyElementID()}')
  expect(PROJECT_LEDGER_GROUP_SOURCE).toContain('class="project-group-chevron"')
  expect(TASK_LIST_SOURCE).not.toContain('class="task-row-meta"')
  expect(SIDEBAR_CSS).not.toContain(".task-row-meta")
  expect(SIDEBAR_CSS).toMatch(/\.task-row-mini\s*\{[^}]*display:\s*grid;/)
  expect(SIDEBAR_CSS).toMatch(
    /\.task-row-mini\s*\{[^}]*grid-template-columns:\s*calc\(20px \* var\(--ui-scale\)\) 0 minmax\(0, 1fr\) max-content;/,
  )
  expect(SIDEBAR_CSS).toMatch(
    /\.task-row-mini\[data-draggable="true"\]\s*\{[^}]*grid-template-columns:\s*calc\(20px \* var\(--ui-scale\)\) calc\(14px \* var\(--ui-scale\)\) minmax\(0, 1fr\) max-content;/,
  )
  expect(SIDEBAR_CSS).toMatch(/\.task-row-mini\s*\{[^}]*width:\s*100%;/)
  expect(SIDEBAR_CSS).toMatch(/\.task-row-badge\s*\{[^}]*grid-column:\s*1;/)
  expect(SIDEBAR_CSS).toMatch(/\.task-row-drag-handle\s*\{[^}]*grid-column:\s*2;/)
  // grid-column:3 lives on the .task-row-body wrapper, not on
  // the ledger-row-main Button itself — the wrapper pairs the optional chevron with
  // the main title button at column 3 so the chevron sits outside the
  // .task-row-actions absolute panel's coverage area (bug 2026-05-27).
  expect(SIDEBAR_CSS).toMatch(/\.task-row-body\s*\{[^}]*grid-column:\s*3;/)
  expect(SIDEBAR_CSS).toMatch(/\.task-row-body\s*\{[^}]*display:\s*flex;/)
  expect(SIDEBAR_CSS).not.toMatch(/(^|\n)\.task-row-main\s*\{/)
  expect(SIDEBAR_CSS).toMatch(/\.oc-button\[data-ui="ledger-row-main"\]\s*\{[^}]*flex:\s*1 1 0;/)
  expect(SIDEBAR_CSS).toMatch(
    /\.oc-button\[data-ui="ledger-row-main"\]\s*\{[^}]*--oc-button-color:\s*var\(--text-soft\);/,
  )
  expect(SIDEBAR_CSS).toMatch(/\.oc-button\[data-ui="ledger-row-main"\]\s*\{[^}]*max-width:\s*100%;/)
  expect(SIDEBAR_CSS).toMatch(/\.oc-button\[data-ui="ledger-row-main"\]\s*\{[^}]*overflow:\s*hidden;/)
  expect(SIDEBAR_CSS).toMatch(/\.oc-button\[data-ui="ledger-row-main"\] strong\s*\{[^}]*min-width:\s*0;/)
  expect(SIDEBAR_CSS).toMatch(/\.oc-button\[data-ui="ledger-row-main"\] strong\s*\{[^}]*max-width:\s*100%;/)
  expect(SIDEBAR_CSS).toMatch(
    /\.oc-button\[data-ui="ledger-row-main"\] strong\s*\{[^}]*color:\s*var\(--text-soft\);/,
  )
  expect(SIDEBAR_CSS).toMatch(/\.task-row-badge-text\s*\{[^}]*position:\s*absolute;/)
  expect(SIDEBAR_CSS).toMatch(/\.task-row-badge-text\s*\{[^}]*clip:\s*rect\(0 0 0 0\);/)
  expect(SIDEBAR_CSS).toMatch(/\.task-row-badge::before\s*\{[^}]*content:\s*"";/)
  expect(SIDEBAR_CSS).toMatch(
    /\.task-row-badge\[data-status="completed"\]\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--good\) 10%, transparent\);/,
  )
  expect(SIDEBAR_CSS).toMatch(
    /\.task-row-badge\[data-status="completed"\]::before\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--good\) 88%, transparent\);/,
  )
  expect(SIDEBAR_CSS).toMatch(/\.task-row-right\s*\{[^}]*flex-direction:\s*row;/)
  expect(SIDEBAR_CSS).toMatch(/\.task-row-right\s*\{[^}]*grid-column:\s*4;/)
  expect(SIDEBAR_CSS).toMatch(/\.task-row-right\s*\{[^}]*flex:\s*0 0 auto;/)
  expect(SIDEBAR_CSS).toMatch(/\.task-row-actions\s*\{[^}]*flex:\s*0 0 auto;/)
  expect(SIDEBAR_CSS).toMatch(/\.task-row-mini\s*\{[^}]*min-height:\s*calc\(28px \* var\(--ui-scale\)\);/)
  expect(SIDEBAR_CSS).toMatch(
    /\.project-group \.oc-button\[data-ui="project-group-toggle"\]\s*\{[^}]*grid-template-columns:\s*calc\(18px \* var\(--ui-scale\)\) minmax\(0, 1fr\) auto calc\(16px \* var\(--ui-scale\)\);/,
  )
  expect(SIDEBAR_CSS).toMatch(
    /\.project-group \.oc-button\[data-ui="project-group-toggle"\]\s*\{[^}]*--oc-button-height:\s*calc\(26px \* var\(--ui-scale\)\);/,
  )
  expect(SIDEBAR_CSS).toMatch(/\.project-group-copy\s*\{[^}]*display:\s*flex;/)
  expect(SIDEBAR_CSS).toMatch(
    /\.project-group \.oc-button\[data-ui="project-group-toggle"\]\s*\{[^}]*min-height:\s*calc\(26px \* var\(--ui-scale\)\);/,
  )
  expect(SIDEBAR_CSS).not.toMatch(/\.project-group-heading\b/)
  expect(SIDEBAR_CSS).toMatch(
    /\.project-group-body\s*\{[^}]*padding-left:\s*calc\(18px \* var\(--ui-scale\) \+ 5px \* var\(--ui-scale\)\);/,
  )
})
