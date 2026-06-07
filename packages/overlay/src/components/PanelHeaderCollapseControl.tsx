import { settingsStore, setSettingsStore, saveSettings } from "../store/settings";
import { t } from "../utils/i18n";
import { Icon } from "./Icon";
import { Button } from "./ui/Button";

function setSidebarCollapsed(value: boolean): void {
  setSettingsStore("sidebarCollapsed", value);
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
