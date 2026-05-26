import { For, Show, createSignal } from "solid-js";
import { loadTasks } from "../store/board";
import { dismissNotification, notificationStore, type AppNotificationItem } from "../services/notify";
import { selectTask } from "../services/task";
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

export async function activateTaskNotification(item: AppNotificationItem): Promise<void> {
  if (!item.taskID) return;
  await selectTask(item.taskID);
  await loadTasks();
  dismissNotification(item.id);
}

function NotificationDetails(props: { details: string }) {
  const [expanded, setExpanded] = createSignal(false);
  const [copied, setCopied] = createSignal(false);
  async function copyDetails(event: MouseEvent): Promise<void> {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(props.details);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.warn("[notify] copy details failed", err);
    }
  }
  return (
    <div class="app-notification__details" data-expanded={expanded() ? "true" : "false"}>
      <div class="app-notification__details-actions">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          tone="neutral"
          data-ui="app-notification-details-toggle"
          aria-expanded={expanded()}
          onClick={(event) => {
            event.stopPropagation();
            setExpanded(!expanded());
          }}
        >
          {expanded() ? t("notify.hide_details") : t("notify.show_details")}
        </Button>
        <Show when={expanded()}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            tone="neutral"
            data-ui="app-notification-details-copy"
            onClick={copyDetails}
          >
            {copied() ? t("notify.copied") : t("notify.copy_details")}
          </Button>
        </Show>
      </div>
      <Show when={expanded()}>
        <pre class="app-notification__details-body">{props.details}</pre>
      </Show>
    </div>
  );
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
            data-task-id={item.taskID || undefined}
            data-clickable={item.taskID ? "true" : undefined}
            role={item.tone === "error" || item.tone === "warning" ? "alert" : "status"}
            aria-live={item.tone === "error" || item.tone === "warning" ? "assertive" : "polite"}
            tabIndex={item.taskID ? 0 : undefined}
            onClick={() => void activateTaskNotification(item)}
            onKeyDown={(event) => {
              if (!item.taskID) return;
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              void activateTaskNotification(item);
            }}
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
              <Show when={item.details}>
                <NotificationDetails details={item.details} />
              </Show>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              tone="neutral"
              data-chrome="icon-action"
              data-ui="app-notification-close"
              title={t("notify.dismiss")}
              aria-label={t("notify.dismiss")}
              onClick={(event) => {
                event.stopPropagation();
                dismissNotification(item.id);
              }}
            >
              <Icon name="close" size={12} />
            </Button>
          </section>
        )}
      </For>
    </div>
  );
}
