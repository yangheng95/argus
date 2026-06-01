import type { Accessor } from "solid-js"
import { onCleanup, onMount } from "solid-js"
import { t } from "../utils/i18n"
import { Tab, Tabs } from "./ui/Tabs"

export type RightPanelTab = "explorer" | "changes" | "inspector"

export const DEFAULT_RIGHT_PANEL_TAB: RightPanelTab = "explorer"

export interface RightPanelTabsProps {
  active: Accessor<RightPanelTab>
  onSelect: (tab: RightPanelTab) => void
}

export function RightPanelTabs(props: RightPanelTabsProps) {
  onMount(() => {
    const openFiles = () => props.onSelect("changes")
    window.addEventListener("delivery:focus-changes", openFiles)
    onCleanup(() => window.removeEventListener("delivery:focus-changes", openFiles))
  })

  return (
    <div class="sections-tabs">
      <Tabs size="sm" tone="neutral" aria-label={`${t("explorer.title")} / ${t("section.files")} / ${t("sections.title")}`} data-ui="right-tabs">
        <Tab
          active={props.active() === "explorer"}
          size="sm"
          tone="neutral"
          data-ui="right-tab"
          onClick={() => props.onSelect("explorer")}
        >
          {t("explorer.title")}
        </Tab>
        <Tab
          active={props.active() === "changes"}
          size="sm"
          tone="neutral"
          data-ui="right-tab"
          onClick={() => props.onSelect("changes")}
        >
          {t("section.files")}
        </Tab>
        <Tab
          active={props.active() === "inspector"}
          size="sm"
          tone="neutral"
          data-ui="right-tab"
          onClick={() => props.onSelect("inspector")}
        >
          {t("sections.title")}
        </Tab>
      </Tabs>
    </div>
  )
}
