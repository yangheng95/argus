import type { Accessor } from "solid-js";
import { t } from "../utils/i18n";
import { Icon } from "./Icon";
import { Button } from "./ui/Button";

interface WorkspaceLayoutControlsProps {
  workspaceOpen: Accessor<boolean>;
  onToggleWorkspace: () => void;
}

export function WorkspaceLayoutControls(props: WorkspaceLayoutControlsProps) {
  return (
    <div class="workspace-layout-controls" data-no-drag="true" role="toolbar" aria-label={t("workspace.toggle")}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        tone="neutral"
        data-ui="workspace-panel-toggle"
        aria-pressed={props.workspaceOpen()}
        title={t("workspace.toggle")}
        aria-label={t("workspace.toggle")}
        onClick={props.onToggleWorkspace}
      >
        <Icon name="terminal" />
      </Button>
    </div>
  );
}
