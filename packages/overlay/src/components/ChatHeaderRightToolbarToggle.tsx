import { rightToolbarOpen, toggleRightToolbarVisible } from "../store/right-toolbar"
import { t } from "../utils/i18n"
import { Icon } from "./Icon"
import { Button } from "./ui/Button"

export function ChatHeaderRightToolbarToggle() {
  const label = () => t(rightToolbarOpen() ? "chat.right_toolbar_close" : "chat.right_toolbar_open")

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      tone="neutral"
      data-ui="chat-header-right-toolbar-toggle"
      data-chrome="chat-header-toolbar-toggle"
      aria-pressed={rightToolbarOpen()}
      title={label()}
      aria-label={label()}
      onClick={toggleRightToolbarVisible}
    >
      <Icon name="panel-right" size={17} />
    </Button>
  )
}
