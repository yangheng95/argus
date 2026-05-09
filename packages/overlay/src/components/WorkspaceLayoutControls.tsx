import type { Accessor } from "solid-js";
import { t } from "../utils/i18n";
import { Icon } from "./Icon";
import { Button } from "./ui/Button";

interface WorkspaceLayoutControlsProps {
  terminalOpen: Accessor<boolean>;
  onOpenTerminal: () => void;
}

export function WorkspaceLayoutControls(props: WorkspaceLayoutControlsProps) {
  return (
    <div class="workspace-layout-controls" data-no-drag="true" role="toolbar" aria-label={t("terminal.open")}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        tone="neutral"
        data-ui="workspace-terminal-open"
        aria-pressed={props.terminalOpen()}
        title={t("terminal.open")}
        aria-label={t("terminal.open")}
        onClick={props.onOpenTerminal}
      >
        <Icon name="terminal" />
      </Button>
    </div>
  );
}
