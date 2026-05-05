import { For, Show } from "solid-js";
import { dismissNotification, notificationStore } from "../services/notify";
import { t } from "../utils/i18n";
import { Icon } from "./Icon";
import { Button } from "./ui/Button";

function toneLabel(tone: string): string {
  if (tone === "success") return "Success";
  if (tone === "warning") return "Warning";
  if (tone === "error") return "Error";
  if (tone === "progress") return "Progress";
  return "Info";
}

export function NotificationCenter() {
  return (
    <div class="app-notifications" role="region" aria-label={t("notify.center_label")} data-testid="notification-center">
      <For each={notificationStore.items}>
        {(item) => (
          <section
            class="app-notification"
            data-tone={item.tone}
            data-notification-id={item.id}
            role={item.tone === "error" || item.tone === "warning" ? "alert" : "status"}
            aria-live={item.tone === "error" || item.tone === "warning" ? "assertive" : "polite"}
          >
            <div class="app-notification__mark" aria-hidden="true">
              <Show when={item.tone === "progress"} fallback={<span>{toneLabel(item.tone).slice(0, 1)}</span>}>
                <span class="app-notification__spinner" />
              </Show>
            </div>
            <div class="app-notification__copy">
              <div class="app-notification__title">{item.title}</div>
              <Show when={item.message}>
                <div class="app-notification__message">{item.message}</div>
              </Show>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              tone="neutral"
              data-ui="app-notification-close"
              title={t("notify.dismiss")}
              aria-label={t("notify.dismiss")}
              onClick={() => dismissNotification(item.id)}
            >
              <Icon name="close" size={12} />
            </Button>
          </section>
        )}
      </For>
    </div>
  );
}
