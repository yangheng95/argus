// ── Desktop notifications ──
//
// Surfaces task lifecycle (success / failure / cancellation / pending
// interaction) as an OS-level notification. In the bundled overlay we
// route through `tauri-plugin-notification` (host.native), which uses
// the OS's native Toast API and survives Windows' AppUserModelID gate
// that silently swallows raw `new Notification(...)` calls inside
// WebView2. In `bun run dev:vite` (browser host) we fall back to the
// Web Notification API so dev still works.
//
// Quiet rules:
//   * Skip when settingsStore.desktopNotifications is false.
//   * Skip when document.hasFocus() AND boardStore.selectedTaskID is the
//     task that just changed — the operator is already looking at it.
//   * Skip if the host reports the notification surface as unsupported.
//
// Permission is requested lazily on the first event the operator opted
// into. Denial sticks for the session and we degrade to a single console
// warning, so we don't keep prompting on every notification.

import { settingsStore } from "../store/settings";
import { boardStore } from "../store/board";
import { messageStore } from "../store/messages";
import { t } from "../utils/i18n";
import { createStore } from "solid-js/store";
import { getHostTransport } from "./host-transport";

type HostPermission = "granted" | "denied" | "default" | "unsupported";

type NotificationKind = "completed" | "failed" | "cancelled" | "interaction";
export type AppNotificationTone = "info" | "success" | "warning" | "error" | "progress";

export interface AppNotificationInput {
  id?: string;
  tone: AppNotificationTone;
  title: string;
  message?: string;
  timeoutMs?: number;
}

export interface AppNotificationItem extends Required<Omit<AppNotificationInput, "timeoutMs">> {
  time: number;
  timeoutMs: number;
}

let permissionRequestPending = false;
let notificationSeq = 0;
const notificationTimers = new Map<string, ReturnType<typeof setTimeout>>();

export const [notificationStore, setNotificationStore] = createStore<{ items: AppNotificationItem[] }>({
  items: [],
});

async function readHostPermission(): Promise<HostPermission> {
  try {
    const result = (await getHostTransport().native({ kind: "notification.permission" })) as HostPermission;
    return result;
  } catch (err) {
    console.warn("[notify] permission probe failed", err);
    return "unsupported";
  }
}

async function requestHostPermission(): Promise<HostPermission> {
  try {
    const result = (await getHostTransport().native({ kind: "notification.requestPermission" })) as HostPermission;
    return result;
  } catch (err) {
    console.warn("[notify] permission request failed", err);
    return "denied";
  }
}

async function sendHostNotification(title: string, body: string, tag: string): Promise<void> {
  try {
    await getHostTransport().native({ kind: "notification.send", title, body, tag });
  } catch (err) {
    console.warn("[notify] failed to dispatch notification", err);
  }
}

function nextNotificationID(): string {
  notificationSeq += 1;
  return `notice_${Date.now()}_${notificationSeq}`;
}

function defaultTimeout(tone: AppNotificationTone): number {
  if (tone === "progress") return 0;
  if (tone === "error" || tone === "warning") return 8000;
  return 5000;
}

function armDismissTimer(id: string, timeoutMs: number): void {
  const existing = notificationTimers.get(id);
  if (existing) clearTimeout(existing);
  notificationTimers.delete(id);
  if (timeoutMs <= 0) return;
  const timer = setTimeout(() => dismissNotification(id), timeoutMs);
  notificationTimers.set(id, timer);
}

export function showNotification(input: AppNotificationInput): string {
  const id = input.id || nextNotificationID();
  const item: AppNotificationItem = {
    id,
    tone: input.tone,
    title: input.title,
    message: input.message || "",
    timeoutMs: input.timeoutMs ?? defaultTimeout(input.tone),
    time: Date.now(),
  };
  const existingIndex = notificationStore.items.findIndex((notice) => notice.id === id);
  if (existingIndex >= 0) {
    setNotificationStore("items", existingIndex, item);
  } else {
    setNotificationStore("items", (items) => [item, ...items].slice(0, 6));
  }
  armDismissTimer(id, item.timeoutMs);
  return id;
}

export function dismissNotification(id: string): void {
  const timer = notificationTimers.get(id);
  if (timer) clearTimeout(timer);
  notificationTimers.delete(id);
  setNotificationStore("items", (items) => items.filter((item) => item.id !== id));
}

export function clearNotifications(): void {
  for (const timer of notificationTimers.values()) clearTimeout(timer);
  notificationTimers.clear();
  setNotificationStore("items", []);
}

export function notifyProgress(input: Omit<AppNotificationInput, "tone">): string {
  return showNotification({ ...input, tone: "progress", timeoutMs: input.timeoutMs ?? 0 });
}

export function notifySuccess(input: Omit<AppNotificationInput, "tone">): string {
  return showNotification({ ...input, tone: "success" });
}

export function notifyWarning(input: Omit<AppNotificationInput, "tone">): string {
  return showNotification({ ...input, tone: "warning" });
}

export function notifyError(input: Omit<AppNotificationInput, "tone">): string {
  return showNotification({ ...input, tone: "error" });
}

/** Force a fresh permission prompt via the host. Tauri host always
 *  returns "granted" on Windows because the OS Toast subsystem is
 *  enabled per-app via Settings, not via in-app prompt; the browser
 *  host (dev) re-prompts via Web Notification API on user gesture. */
export async function requestNotificationPermission(): Promise<HostPermission> {
  if (permissionRequestPending) return readHostPermission();
  permissionRequestPending = true;
  try {
    return await requestHostPermission();
  } finally {
    permissionRequestPending = false;
  }
}

export async function ensureDesktopNotificationPermission(
  source: "startup" | "settings" = "settings",
): Promise<HostPermission> {
  if (!settingsStore.desktopNotifications) return "denied";
  const state = await readHostPermission();
  if (state === "unsupported") {
    notifyWarning({
      id: "system:notification-permission",
      title: t("notify.permission_unsupported_title"),
      message: t("notify.permission_unsupported_body"),
    });
    return "unsupported";
  }
  if (state === "granted") return "granted";
  if (state === "denied") {
    notifyWarning({
      id: "system:notification-permission",
      title: t("notify.permission_blocked_title"),
      message: t("notify.permission_blocked_body"),
    });
    return "denied";
  }
  try {
    const result = await requestNotificationPermission();
    if (result === "granted") {
      notifySuccess({
        id: "system:notification-permission",
        title: t("notify.permission_granted_title"),
        message: source === "startup"
          ? t("notify.permission_granted_startup_body")
          : t("notify.permission_granted_settings_body"),
      });
      return result;
    }
    notifyWarning({
      id: "system:notification-permission",
      title: t("notify.permission_blocked_title"),
      message: t("notify.permission_blocked_body"),
    });
    return result;
  } catch (err) {
    notifyWarning({
      id: "system:notification-permission",
      title: t("notify.permission_blocked_title"),
      message: t("notify.permission_request_failed_body", {
        error: err instanceof Error ? err.message : String(err),
      }),
    });
    return "denied";
  }
}

function lookupTaskTitle(taskID: string): string {
  if (!taskID) return "";
  const list = boardStore.tasks ?? [];
  for (const item of list as any[]) {
    const id = item?.task?.id;
    if (id && id === taskID) {
      return String(item?.task?.title || item?.overview?.headline || taskID);
    }
  }
  if (boardStore.selectedTaskID === taskID && boardStore.board?.task?.title) {
    return String(boardStore.board.task.title);
  }
  return taskID;
}

function shouldSuppressDesktop(taskID: string): boolean {
  if (!settingsStore.desktopNotifications) return true;
  // The operator is already looking at the task that just changed and the
  // window has focus — no need to vibrate the OS shell about it.
  const focused = typeof document !== "undefined" && typeof document.hasFocus === "function" && document.hasFocus();
  return focused && boardStore.selectedTaskID === taskID;
}

// (Title / body keys are resolved inline at the t() call site below using
// template literals — `notify.task.${kind}.title`. The check-panel-i18n
// linter only sees template literals when they appear directly in t()'s
// first argument, so we cannot route through a helper that returns a
// string. Same constraint that BoardIntro hits with intro.mode.${mode}.)

async function dispatch(taskID: string, kind: NotificationKind, override?: { body?: string }): Promise<void> {
  if (!taskID) return;
  const title = t(`notify.task.${kind}.title`);
  const taskTitle = lookupTaskTitle(taskID);
  const body = override?.body ?? t(`notify.task.${kind}.body`, { title: taskTitle });
  const tone: AppNotificationTone =
    kind === "completed" ? "success" :
      kind === "failed" ? "error" :
        kind === "cancelled" ? "warning" : "info";
  showNotification({
    id: `task:${taskID}:${kind}`,
    tone,
    title,
    message: body,
  });
  if (shouldSuppressDesktop(taskID)) return;
  const permission = await readHostPermission();
  if (permission !== "granted") return;
  // tag coalesces successive notifications for the same task into a
  // single notification slot in the OS shell (tauri-plugin-notification
  // forwards it to WinRT's Group/Tag identifiers; Web Notification API
  // honors `tag` natively in dev).
  await sendHostNotification(title, body, `oc:${taskID}:${kind}`);
}

// Public entry points called from the SSE event router.

const lastDispatched = new Map<string, NotificationKind>();

export function notifyTaskLifecycle(taskID: string, type: string): void {
  if (!taskID || !type) return;
  let kind: NotificationKind | null = null;
  if (type === "task.completed") kind = "completed";
  else if (type === "task.failed") kind = "failed";
  else if (type === "task.cancelled") kind = "cancelled";
  if (!kind) return;
  // Coalesce: the orchestrator emits both task.updated and task.completed in
  // quick succession; we only want the terminal event to ring once per task.
  const prev = lastDispatched.get(taskID);
  if (prev === kind) return;
  lastDispatched.set(taskID, kind);
  void dispatch(taskID, kind);
}

export function notifyInteractionRequested(taskID: string, summary?: string): void {
  if (!taskID) return;
  const body = summary
    ? t("notify.task.interaction.body_with_detail", { title: lookupTaskTitle(taskID), detail: summary })
    : undefined;
  void dispatch(taskID, "interaction", body ? { body } : undefined);
}

// Reset the per-task dedupe map when the task is removed, so a re-run of
// the same task ID can ring again. Hook the messageStore reset path.
export function clearTaskNotificationState(taskID?: string): void {
  if (!taskID) {
    lastDispatched.clear();
    return;
  }
  lastDispatched.delete(taskID);
}

// W2-V34: primeNotificationPermission() removed. Permission prompting now
// goes through ensureDesktopNotificationPermission(), which is shared by
// startup and the settings toggle and always surfaces blockers through the
// in-app notification center. Lifecycle event handlers keep using the
// read-only permission path so task events do not repeatedly prompt.

// Touch a store reference so eslint / tree-shake knows we depend on it
// (the import is here for createEffect-driven future enhancements).
void messageStore;
