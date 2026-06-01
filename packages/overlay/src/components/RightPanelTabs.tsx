import type { Accessor } from "solid-js"
import { onCleanup, onMount } from "solid-js"
import { t } from "../utils/i18n"
import { Tab, Tabs } from "./ui/Tabs"

export type RightPanelTab = "files" | "inspector"

export const DEFAULT_RIGHT_PANEL_TAB: RightPanelTab = "files"

export interface RightPanelTabsProps {
  active: Accessor<RightPanelTab>
  onSelect: (tab: RightPanelTab) => void
}

export function RightPanelTabs(props: RightPanelTabsProps) {
  onMount(() => {
    const openFiles = () => props.onSelect("files")
    window.addEventListener("delivery:focus-changes", openFiles)
    onCleanup(() => window.removeEventListener("delivery:focus-changes", openFiles))
  })

  return (
    <div class="sections-tabs">
      <Tabs size="sm" tone="neutral" aria-label={`${t("sections.title")} / ${t("section.files")}`} data-ui="right-tabs">
        <Tab
          active={props.active() === "files"}
          size="sm"
          tone="neutral"
          data-ui="right-tab"
          onClick={() => props.onSelect("files")}
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
