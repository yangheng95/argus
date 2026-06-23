import { createSignal, Show, type JSX } from "solid-js"
import { t } from "../utils/i18n"
import { projectDirectoryKey, projectDirectoryLabel } from "../utils/project-directory"
import { Icon } from "./Icon"
import { Button } from "./ui/Button"
import { ArmedConfirmButton } from "./ui/ArmedConfirmButton"

const PROJECT_CONFIRM_WINDOW_SECONDS = 3
const PROJECT_CONFIRM_WINDOW_MS = PROJECT_CONFIRM_WINDOW_SECONDS * 1000 // confirm window length in milliseconds.

export interface ProjectLedgerGroupProps {
  directory: string
  count: number
  collapsed: boolean
  onToggle: () => void
  onDeleteProject?: (directory: string) => void | Promise<void>
  children: JSX.Element
  class?: string
  dataUi?: string
  title?: string
}

export function createProjectLedgerGroupCollapseState() {
  const [collapsedDirectories, setCollapsedDirectories] = createSignal<Record<string, boolean>>({})

  function isCollapsed(directory: string): boolean {
    return collapsedDirectories()[projectDirectoryKey(directory)] === true
  }

  function toggle(directory: string): void {
    const key = projectDirectoryKey(directory)
    setCollapsedDirectories((current) => {
      const next = { ...current }
      if (next[key]) delete next[key]
      else next[key] = true
      return next
    })
  }

  return { isCollapsed, toggle }
}

export function projectLedgerGroupTip(directory: string, count: number): string {
  return [directory || t("task.project.unknown"), t("task.project.count", { count: String(count) })]
    .filter(Boolean)
    .join(" / ")
}

function projectLedgerGroupBodyElementID(directory: string, dataUi: string | undefined): string {
  const namespace = dataUi || "task-project-group"
  const raw = `${namespace}-${projectDirectoryKey(directory)}-body`
  return raw.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "project-group-body"
}

export function ProjectLedgerGroup(props: ProjectLedgerGroupProps) {
  const label = () => projectDirectoryLabel(props.directory, t("task.project.unknown"))
  const className = () => ["project-group", props.class].filter(Boolean).join(" ")
  const countText = () => String(props.count)
  const title = () => props.title || projectLedgerGroupTip(props.directory, props.count)
  const bodyElementID = () => projectLedgerGroupBodyElementID(props.directory, props.dataUi)
  const canDeleteProject = () => !!props.onDeleteProject && !!props.directory.trim()

  return (
    <section class={className()} data-ui={props.dataUi} data-collapsed={props.collapsed ? "true" : undefined}>
      <div class="project-group-head">
        <Button
          type="button"
          variant="ghost"
          size="mini"
          tone="neutral"
          data-ui="project-group-toggle"
          title={title()}
          aria-expanded={props.collapsed ? "false" : "true"}
          aria-controls={props.collapsed ? undefined : bodyElementID()}
          aria-label={
            props.collapsed
              ? t("task.project.expand", { name: label().name })
              : t("task.project.collapse", { name: label().name })
          }
          onClick={props.onToggle}
        >
          <span class="project-group-icon" aria-hidden="true">
            <Icon name={props.collapsed ? "folder" : "folder-open"} size={15} />
          </span>
          <span class="project-group-copy">
            <span class="project-group-name">{label().name}</span>
            <Show when={label().parent}>
              <span class="project-group-parent">{label().parent}</span>
            </Show>
          </span>
          <span class="project-group-count" aria-label={t("task.project.count", { count: countText() })}>
            {countText()}
          </span>
          <span class="project-group-chevron" aria-hidden="true">
            <Icon name={props.collapsed ? "chevron" : "chevron-down"} size={12} />
          </span>
        </Button>
        <Show when={canDeleteProject()}>
          <ArmedConfirmButton
            type="button"
            variant="ghost"
            size="icon"
            tone="danger"
            data-chrome="icon-action"
            data-ui="project-group-delete"
            data-project-delete={props.directory}
            label={t("project.delete_button_title")}
            armedDescription={t("armed_confirm.project.delete", { seconds: PROJECT_CONFIRM_WINDOW_SECONDS })}
            confirmWindowMs={PROJECT_CONFIRM_WINDOW_MS}
            onConfirm={() => {
              void props.onDeleteProject?.(props.directory)
            }}
            confirmChildren={
              <span class="project-group-delete-icon" data-icon="confirm" aria-hidden="true">
                <Icon name="check" size={12} />
              </span>
            }
          >
            <span class="project-group-delete-icon" data-icon="delete" aria-hidden="true">
              <Icon name="delete" size={12} />
            </span>
          </ArmedConfirmButton>
        </Show>
      </div>
      <Show when={!props.collapsed}>
        <div id={bodyElementID()} class="project-group-body">
          {props.children}
        </div>
      </Show>
    </section>
  )
}
