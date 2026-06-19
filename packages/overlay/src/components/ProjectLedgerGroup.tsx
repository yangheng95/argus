import { createSignal, Show, type JSX } from "solid-js"
import { t } from "../utils/i18n"
import { projectDirectoryKey, projectDirectoryLabel } from "../utils/project-directory"
import { Icon } from "./Icon"
import { Button } from "./ui/Button"

export interface ProjectLedgerGroupProps {
  directory: string
  count: number
  collapsed: boolean
  onToggle: () => void
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

export function ProjectLedgerGroup(props: ProjectLedgerGroupProps) {
  const label = () => projectDirectoryLabel(props.directory, t("task.project.unknown"))
  const className = () => ["project-group", props.class].filter(Boolean).join(" ")
  const countText = () => String(props.count)
  const title = () => props.title || projectLedgerGroupTip(props.directory, props.count)

  return (
    <section
      class={className()}
      data-ui={props.dataUi}
      data-collapsed={props.collapsed ? "true" : undefined}
    >
      <Button
        type="button"
        variant="ghost"
        size="mini"
        tone="neutral"
        data-ui="project-group-toggle"
        title={title()}
        aria-expanded={props.collapsed ? "false" : "true"}
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
      <Show when={!props.collapsed}>
        <div class="project-group-body">{props.children}</div>
      </Show>
    </section>
  )
}
