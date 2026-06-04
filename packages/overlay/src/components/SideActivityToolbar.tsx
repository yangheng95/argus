import { For, type Accessor, type JSX } from "solid-js"
import { t } from "../utils/i18n"
import { Icon, type IconName } from "./Icon"
import { Button } from "./ui/Button"

export interface SideActivity<T extends string> {
  id: T
  icon: IconName
  labelKey: string
}

export interface SideActivityToolbarProps<T extends string> {
  side: "left" | "right"
  activities: readonly SideActivity<T>[]
  active: Accessor<T>
  ariaLabelKey: string
  onSelect: (activity: T) => void
  trailing?: JSX.Element
}

export function SideActivityToolbar<T extends string>(props: SideActivityToolbarProps<T>) {
  return (
    <nav class="side-activity-toolbar" data-side={props.side} aria-label={t(props.ariaLabelKey)}>
      <div class="side-activity-toolbar__items" role="toolbar" aria-label={t(props.ariaLabelKey)}>
        <For each={props.activities}>
          {(activity) => {
            const label = () => t(activity.labelKey)
            const active = () => props.active() === activity.id
            return (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                tone="neutral"
                data-ui="side-activity-button"
                data-side={props.side}
                data-activity={activity.id}
                data-active={active() ? "true" : "false"}
                aria-pressed={active()}
                title={label()}
                aria-label={label()}
                onClick={() => props.onSelect(activity.id)}
              >
                <Icon name={activity.icon} />
                <span class="side-activity-label">{label()}</span>
              </Button>
            )
          }}
        </For>
      </div>
      <div class="side-activity-toolbar__trailing">{props.trailing}</div>
    </nav>
  )
}
