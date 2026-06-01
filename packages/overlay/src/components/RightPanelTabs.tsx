import type { Accessor } from "solid-js"
import { t } from "../utils/i18n"
import { Tab, Tabs } from "./ui/Tabs"

export type RightPanelTab = "explorer" | "inspector"

export const DEFAULT_RIGHT_PANEL_TAB: RightPanelTab = "explorer"

export interface RightPanelTabsProps {
  active: Accessor<RightPanelTab>
  onSelect: (tab: RightPanelTab) => void
}

export function RightPanelTabs(props: RightPanelTabsProps) {
  return (
    <div class="sections-tabs">
      <Tabs
        size="sm"
        tone="neutral"
        value={props.active()}
        onValueChange={(value) => props.onSelect(value as RightPanelTab)}
        aria-label={`${t("explorer.title")} / ${t("sections.title")}`}
        data-ui="right-tabs"
      >
        <Tab
          value="explorer"
          active={props.active() === "explorer"}
          size="sm"
          tone="neutral"
          data-ui="right-tab"
          onClick={() => props.onSelect("explorer")}
        >
          {t("explorer.title")}
        </Tab>
        <Tab
          value="inspector"
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
