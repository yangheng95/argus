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

export function LeftPanelHeaderCollapseControl() {
  const collapsed = () => settingsStore.sidebarCollapsed;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      tone="neutral"
      data-ui="sidebar-header-collapse-toggle"
      data-collapsed={collapsed() ? "true" : "false"}
      aria-pressed={!collapsed()}
      title={collapsed() ? t("sidebar.open") : t("sidebar.close")}
      aria-label={collapsed() ? t("sidebar.open") : t("sidebar.close")}
      onClick={() => setSidebarCollapsed(!collapsed())}
    >
      <Icon name="panel-left" />
    </Button>
  );
}

export function RightPanelHeaderCollapseControl() {
  const collapsed = () => settingsStore.rightPanelCollapsed;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      tone="neutral"
      data-ui="right-panel-header-collapse-toggle"
      data-collapsed={collapsed() ? "true" : "false"}
      aria-pressed={!collapsed()}
      title={collapsed() ? t("right_panel.open") : t("right_panel.close")}
      aria-label={collapsed() ? t("right_panel.open") : t("right_panel.close")}
      onClick={() => setRightPanelCollapsed(!collapsed())}
    >
      <Icon name="panel-right" />
    </Button>
  );
}
