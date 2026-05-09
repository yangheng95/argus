import { settingsStore, setSettingsStore, saveSettings } from "../store/settings";
import { t } from "../utils/i18n";
import { Icon } from "./Icon";
import { Button } from "./ui/Button";

function setSidebarCollapsed(value: boolean): void {
  setSettingsStore("sidebarCollapsed", value);
  saveSettings();
}

function setRightPanelCollapsed(value: boolean): void {
  setSettingsStore("rightPanelCollapsed", value);
  saveSettings();
}

export function PaneEdgeControls() {
  const leftCollapsed = () => settingsStore.sidebarCollapsed;
  const rightCollapsed = () => settingsStore.rightPanelCollapsed;

  return (
    <div class="pane-edge-controls" aria-label={t("layout.controls")}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        tone="neutral"
        data-ui="workspace-left-panel-toggle"
        data-side="left"
        data-collapsed={leftCollapsed() ? "true" : "false"}
        aria-pressed={!leftCollapsed()}
        title={leftCollapsed() ? t("sidebar.open") : t("sidebar.close")}
        aria-label={leftCollapsed() ? t("sidebar.open") : t("sidebar.close")}
        onClick={() => setSidebarCollapsed(!leftCollapsed())}
      >
        <Icon name="panel-left" size={15} />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        tone="neutral"
        data-ui="workspace-right-panel-toggle"
        data-side="right"
        data-collapsed={rightCollapsed() ? "true" : "false"}
        aria-pressed={!rightCollapsed()}
        title={rightCollapsed() ? t("right_panel.open") : t("right_panel.close")}
        aria-label={rightCollapsed() ? t("right_panel.open") : t("right_panel.close")}
        onClick={() => setRightPanelCollapsed(!rightCollapsed())}
      >
        <Icon name="panel-right" size={15} />
      </Button>
    </div>
  );
}
