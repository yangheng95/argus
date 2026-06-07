import { For, Show, createMemo, createSignal } from "solid-js";
import { loadTasks } from "../store/board";
import {
  dismissNotification,
  notificationStore,
  notificationTaskTitle,
  visibleNotificationItems,
  type AppNotificationItem,
} from "../services/notify";
import { selectTask } from "../services/task";
import { t } from "../utils/i18n";
import { Icon } from "./Icon";
import { Button } from "./ui/Button";

type NotificationSurface = "toast" | "panel";

interface NotificationCenterProps {
  surface?: NotificationSurface;
}

interface NotificationGroup {
  key: string;
  title: string;
  items: AppNotificationItem[];
}

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
      </div>
      <Show when={expanded()}>
        <pre class="app-notification__details-body">{props.details}</pre>
      </Show>
    </div>
  );
}

function groupByTask(items: AppNotificationItem[]): NotificationGroup[] {
  const groups: NotificationGroup[] = [];
  const indexByKey = new Map<string, number>();
  for (const item of items) {
    const key = item.taskID || "system";
    let index = indexByKey.get(key);
    if (index === undefined) {
      index = groups.length;
      indexByKey.set(key, index);
      groups.push({
        key,
        title: item.taskID ? notificationTaskTitle(item.taskID) : t("notify.system_group"),
        items: [],
      });
    }
    groups[index]!.items.push(item);
  }
  return groups;
}

function NotificationItem(props: { item: AppNotificationItem; surface: NotificationSurface }) {
  return (
    <section
      class="app-notification"
      data-tone={props.item.tone}
      data-notification-id={props.item.id}
      data-task-id={props.item.taskID || undefined}
      data-clickable={props.item.taskID ? "true" : undefined}
      data-dismissed={props.item.dismissedAt > 0 ? "true" : "false"}
      role={props.item.tone === "error" || props.item.tone === "warning" ? "alert" : "status"}
      aria-live={props.item.tone === "error" || props.item.tone === "warning" ? "assertive" : "polite"}
      tabIndex={props.item.taskID ? 0 : undefined}
      onClick={() => void activateTaskNotification(props.item)}
      onKeyDown={(event) => {
        if (!props.item.taskID) return;
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        void activateTaskNotification(props.item);
      }}
    >
      <div class="app-notification__mark" aria-hidden="true">
        <Show when={props.item.tone === "progress"} fallback={<span>{toneLabel(props.item.tone).slice(0, 1)}</span>}>
          <span class="app-notification__spinner" />
        </Show>
      </div>
      <div class="app-notification__copy">
        <div class="app-notification__title">{props.item.title}</div>
        <Show when={props.item.message}>
          <div class="app-notification__message">{props.item.message}</div>
        </Show>
        <Show when={props.item.details}>
          <NotificationDetails details={props.item.details} />
        </Show>
      </div>
      <Show when={props.surface === "toast"}>
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
            dismissNotification(props.item.id);
          }}
        >
          <Icon name="close" size={12} />
        </Button>
      </Show>
    </section>
  );
}

export function NotificationCenter(props: NotificationCenterProps) {
  const surface = () => props.surface ?? "toast";
  const items = createMemo(() => surface() === "toast" ? visibleNotificationItems() : notificationStore.items);
  const groups = createMemo(() => groupByTask(items()));

  return (
    <div
      class="app-notifications"
      data-surface={surface()}
      role="region"
      aria-label={t("notify.center_label")}
      data-testid="notification-center"
    >
      <Show
        when={items().length > 0}
        fallback={
          <Show when={surface() === "panel"}>
            <div class="app-notification-empty">
              <div class="app-notification-empty__title">{t("notify.empty_title")}</div>
              <div class="app-notification-empty__body">{t("notify.empty_body")}</div>
            </div>
          </Show>
        }
      >
        <Show
          when={surface() === "panel"}
          fallback={
            <For each={items()}>
              {(item) => <NotificationItem item={item} surface={surface()} />}
            </For>
          }
        >
          <For each={groups()}>
            {(group) => (
              <section class="app-notification-group" data-task-id={group.key === "system" ? undefined : group.key}>
                <header class="app-notification-group__header">
                  <span class="app-notification-group__title">{group.title}</span>
                  <span class="app-notification-group__count">{group.items.length}</span>
                </header>
                <div class="app-notification-group__items">
                  <For each={group.items}>
                    {(item) => <NotificationItem item={item} surface={surface()} />}
                  </For>
                </div>
              </section>
            )}
          </For>
        </Show>
      </Show>
    </div>
  );
}
