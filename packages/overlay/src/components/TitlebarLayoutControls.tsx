import { settingsStore, setSettingsStore, saveSettings } from "../store/settings";
import { t } from "../utils/i18n";
import { Icon } from "./Icon";
import { Button } from "./ui/Button";
import type { Accessor } from "solid-js";

interface TitlebarLayoutControlsProps {
  workspaceOpen: Accessor<boolean>;
  onToggleWorkspace: () => void;
}

function setSidebarCollapsed(value: boolean): void {
  setSettingsStore("sidebarCollapsed", value);
  saveSettings();
}

function setRightPanelCollapsed(value: boolean): void {
  setSettingsStore("rightPanelCollapsed", value);
  saveSettings();
}

export function TitlebarLayoutControls(props: TitlebarLayoutControlsProps) {
  const leftCollapsed = () => settingsStore.sidebarCollapsed;
  const rightCollapsed = () => settingsStore.rightPanelCollapsed;

  return (
    <div class="titlebar-layout-controls" data-no-drag="true" role="toolbar" aria-label={t("layout.controls")}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        tone="neutral"
        data-ui="titlebar-left-panel-toggle"
        aria-pressed={!leftCollapsed()}
        title={leftCollapsed() ? t("sidebar.open") : t("sidebar.close")}
        aria-label={leftCollapsed() ? t("sidebar.open") : t("sidebar.close")}
        onClick={() => setSidebarCollapsed(!leftCollapsed())}
      >
        <Icon name="panel-left" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        tone="neutral"
        data-ui="titlebar-terminal-anchor"
        aria-pressed={props.workspaceOpen()}
        title={t("workspace.toggle")}
        aria-label={t("workspace.toggle")}
        onClick={props.onToggleWorkspace}
      >
        <Icon name="terminal" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        tone="neutral"
        data-ui="titlebar-right-panel-toggle"
        aria-pressed={!rightCollapsed()}
        title={rightCollapsed() ? t("right_panel.open") : t("right_panel.close")}
        aria-label={rightCollapsed() ? t("right_panel.open") : t("right_panel.close")}
        onClick={() => setRightPanelCollapsed(!rightCollapsed())}
      >
        <Icon name="panel-right" />
      </Button>
    </div>
  );
}
