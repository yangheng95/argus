// ── Desktop notifications ──
//
// Surfaces task-aggregate events with stamped notify metadata as in-app
// and OS-level notifications. In the bundled overlay we
// route through `tauri-plugin-notification` (host.native), which uses
// the OS's native Toast API and survives Windows' AppUserModelID gate
// that silently swallows raw `new Notification(...)` calls inside
// WebView2. In `bun run dev:vite` (browser host) we fall back to the
// Web Notification API so dev still works.
//
// Quiet rules:
//   * Tier 1 always shows an in-app toast; OS notification is skipped only
//     when the focused task detail is already showing the selected task.
//   * Tier 2 always shows an in-app toast; OS notification fires only when
//     the overlay window is unfocused.
//   * Tier 3 stays in the existing in-app event feed only.
//   * Tauri host attempts native acceptance directly after focus/settings
//     checks; browser host still requires a granted Web Notification
//     permission before dispatch.
//
// Permission is requested only from the Settings toggle, which is a real
// user gesture in every host. Task lifecycle events keep the permission
// path read-only, so WebKit/Tauri cannot pin the app into a denied state
// during startup or background SSE dispatch.

import { settingsStore } from "../store/settings";
import { boardStore, setTaskListProjectionHandler,
  activeTaskID,
} from "../store/board";
import { isMissionPage } from "../store/page-mode";
import { t } from "../utils/i18n";
import { createStore } from "solid-js/store";
import { getHostTransport } from "./host-transport";
import { setDockBadge, setTrayAttention } from "./window";
import { loadBadgeAckKeys, saveBadgeAckKeys } from "./overlay-settings-storage";

type HostPermission = "granted" | "denied" | "default" | "unsupported";

export type AppNotificationTone = "info" | "success" | "warning" | "error" | "progress";

export interface NotifyDescriptor {
  tier: 1 | 2 | 3;
  badge?: boolean;
}

export interface RoutedNotificationEvent {
  type: string;
  taskID?: string | null;
  notify?: NotifyDescriptor;
  notificationDetails?: string;
  details?: string;
  payload?: Record<string, unknown>;
  summary?: string;
}

export interface AppNotificationInput {
  id?: string;
  tone: AppNotificationTone;
  title: string;
  message?: string;
  // Full diagnostic payload (stack, HTTP body, JSON dump). Rendered in a
  // collapsible <pre> below the message so the visible toast stays compact
  // while the operator can still copy the underlying failure verbatim.
  details?: string;
  taskID?: string;
  timeoutMs?: number;
  centerHistory?: boolean;
}

export interface AppNotificationItem {
  id: string;
  tone: AppNotificationTone;
  title: string;
  message: string;
  details: string;
  taskID: string;
  time: number;
  timeoutMs: number;
  dismissedAt: number;
  centerHistory: boolean;
}

let permissionRequestPending = false;
let notificationSeq = 0;
const notificationTimers = new Map<string, ReturnType<typeof setTimeout>>();
const MAX_NOTIFICATION_HISTORY = 100;

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
  // error/warning toasts now persist until the operator dismisses them.
  // Auto-dismiss after a few seconds hid actionable diagnostics (e.g. an
  // import that failed while the user was looking elsewhere).
  if (tone === "progress" || tone === "error" || tone === "warning") return 0;
  return 5000;
}

function defaultCenterHistory(tone: AppNotificationTone): boolean {
  return tone === "error" || tone === "warning";
}

/**
 * Render a thrown value into a multi-line detail string suitable for the
 * notification's collapsible details block. Pulls stack, and — when the
 * error is an ApiError — the HTTP status / path / response body.
 */
export function formatErrorDetails(err: unknown): string {
  if (err == null) return "";
  if (err instanceof Error) {
    const parts: string[] = [];
    const meta = err as Error & { status?: unknown; path?: unknown; body?: unknown };
    if (typeof meta.status === "number" && typeof meta.path === "string") {
      parts.push(`HTTP ${meta.status} ${meta.path}`);
    }
    parts.push(err.stack || `${err.name}: ${err.message}`);
    if (meta.body !== undefined) {
      let rendered: string;
      try {
        rendered = typeof meta.body === "string" ? meta.body : JSON.stringify(meta.body, null, 2);
      } catch {
        rendered = String(meta.body);
      }
      if (rendered) parts.push(`response body:\n${rendered}`);
    }
    return parts.join("\n\n");
  }
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err, null, 2);
  } catch {
    return String(err);
  }
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
    details: input.details || "",
    taskID: input.taskID || "",
    timeoutMs: input.timeoutMs ?? defaultTimeout(input.tone),
    time: Date.now(),
    dismissedAt: 0,
    centerHistory: input.centerHistory ?? defaultCenterHistory(input.tone),
  };
  const existingIndex = notificationStore.items.findIndex((notice) => notice.id === id);
  if (existingIndex >= 0) {
    setNotificationStore("items", existingIndex, item);
  } else {
    setNotificationStore("items", (items) => [item, ...items].slice(0, MAX_NOTIFICATION_HISTORY));
  }
  armDismissTimer(id, item.timeoutMs);
  return id;
}

export function dismissNotification(id: string): void {
  const timer = notificationTimers.get(id);
  if (timer) clearTimeout(timer);
  notificationTimers.delete(id);
  const index = notificationStore.items.findIndex((item) => item.id === id);
  if (index < 0) return;
  if (!notificationStore.items[index]?.centerHistory) {
    setNotificationStore("items", (items) => items.filter((item) => item.id !== id));
    return;
  }
  setNotificationStore("items", index, "dismissedAt", Date.now());
}

export function clearNotifications(): void {
  for (const timer of notificationTimers.values()) clearTimeout(timer);
  notificationTimers.clear();
  setNotificationStore("items", []);
}

export function visibleNotificationItems(): AppNotificationItem[] {
  return notificationStore.items.filter((item) => item.dismissedAt <= 0);
}

export function centerHistoryNotificationItems(): AppNotificationItem[] {
  return notificationStore.items.filter((item) => item.centerHistory);
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

export async function ensureDesktopNotificationPermission(): Promise<HostPermission> {
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
        message: t("notify.permission_granted_settings_body"),
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

export function notificationTaskTitle(taskID: string): string {
  if (!taskID) return "";
  const list = boardStore.tasks ?? [];
  for (const item of list as any[]) {
    const id = item?.task?.id;
    if (id && id === taskID) {
      return String(item?.task?.title || item?.overview?.headline || taskID);
    }
  }
  if (activeTaskID() === taskID && boardStore.board?.task?.title) {
    return String(boardStore.board.task.title);
  }
  return taskID;
}

function windowFocused(): boolean {
  return typeof document !== "undefined" && typeof document.hasFocus === "function" && document.hasFocus();
}

function taskIDForEvent(event: RoutedNotificationEvent): string {
  return String(event.taskID || "");
}

function eventCopyKey(type: string, notify: NotifyDescriptor): string {
  const normalized = type.replace(/\./g, "_").replace(/-/g, "_");
  const suffix = type === "evaluation.completed" && notify.tier === 1 && notify.badge
    ? "rejected"
    : type === "evaluation.completed" && notify.tier === 2
      ? "accepted"
      : notify.tier === 1
        ? "urgent"
        : "notice";
  return `${normalized}.${suffix}`;
}

function toneForTier(notify: NotifyDescriptor): AppNotificationTone {
  if (notify.tier === 1) return "error";
  if (notify.tier === 2) return "info";
  return "info";
}

function notificationDetails(event: RoutedNotificationEvent): string {
  if (typeof event.notificationDetails === "string") return event.notificationDetails;
  if (typeof event.details === "string") return event.details;
  if (!event.payload && !event.summary) return "";
  try {
    return JSON.stringify({
      type: event.type,
      taskID: event.taskID ?? null,
      summary: event.summary ?? "",
      payload: event.payload ?? {},
    }, null, 2);
  } catch {
    return String(event.summary || "");
  }
}

function shouldSendDesktop(event: RoutedNotificationEvent, taskID: string): boolean {
  if (!settingsStore.desktopNotifications) return false;
  const focused = windowFocused();
  if (event.notify?.tier === 2) return !focused;
  if (event.notify?.tier !== 1) return false;
  return !(focused && taskID && activeTaskID() === taskID && !isMissionPage());
}

async function sendDesktopIfAllowed(
  event: RoutedNotificationEvent,
  taskID: string,
  title: string,
  body: string,
): Promise<void> {
  if (!shouldSendDesktop(event, taskID)) return;
  if (getHostTransport().kind === "tauri") {
    await sendHostNotification(title, body, `oc:${taskID || "global"}:${event.type}`);
    return;
  }
  const permission = await readHostPermission();
  if (permission !== "granted") return;
  await sendHostNotification(title, body, `oc:${taskID || "global"}:${event.type}`);
}

export function routeNotification(event: RoutedNotificationEvent): void {
  const notify = event.notify;
  if (!notify || notify.tier === 3) return;
  const taskID = taskIDForEvent(event);
  const copyKey = eventCopyKey(event.type, notify);
  const title = t(`notify.event.${copyKey}.title`);
  const body = t(`notify.event.${copyKey}.body`, { title: notificationTaskTitle(taskID) });
  showNotification({
    id: `event:${taskID || "global"}:${event.type}:${notify.tier}`,
    tone: toneForTier(notify),
    title,
    message: body,
    details: notificationDetails(event),
    taskID,
    centerHistory: true,
  });
  void sendDesktopIfAllowed(event, taskID, title, body);
}

export type BadgeAckKey =
  | `task-interactions:${string}:${number}`
  | `task-failed:${string}:${number}`
  | `evaluation-rejected:${string}:${number}`;

export interface BadgeProjection {
  count: number;
}

function factVersion(value: unknown, label: string): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`computeBadge: ${label} is missing a positive version timestamp`);
  }
  return number;
}

export function taskFailedAckKey(item: any): BadgeAckKey {
  const task = item?.task ?? item;
  const taskID = String(task?.id || "");
  if (!taskID) throw new Error("computeBadge: failed task is missing task.id");
  const version = factVersion(task?.time?.completed ?? task?.time?.updated, `task ${taskID} failure time`);
  return `task-failed:${taskID}:${version}`;
}

export function taskInteractionAckKey(item: any): BadgeAckKey {
  const task = item?.task ?? item;
  const taskID = String(task?.id || "");
  if (!taskID) throw new Error("computeBadge: pending-interaction task is missing task.id");
  const version = factVersion(task?.time?.updated, `task ${taskID} pending-interaction time`);
  return `task-interactions:${taskID}:${version}`;
}

export function evaluationRejectedAckKey(evaluation: any): BadgeAckKey {
  const evaluationID = String(evaluation?.id || "");
  if (!evaluationID) throw new Error("computeBadge: rejected evaluation is missing evaluation.id");
  const version = factVersion(
    evaluation?.time?.completed ?? evaluation?.time?.updated,
    `evaluation ${evaluationID} rejection time`,
  );
  return `evaluation-rejected:${evaluationID}:${version}`;
}

export function computeBadge(globalSummary: readonly any[], acks: ReadonlySet<string>): BadgeProjection {
  let count = 0;
  for (const item of globalSummary) {
    const pending = Number(item?.pending_interactions ?? 0);
    if (Number.isFinite(pending) && pending > 0 && !acks.has(taskInteractionAckKey(item))) count += pending;
    if ((item?.task ?? item)?.status === "failed" && !acks.has(taskFailedAckKey(item))) count += 1;
    const evaluation = item?.evaluation;
    if (evaluation?.verdict === "rejected" && !acks.has(evaluationRejectedAckKey(evaluation))) count += 1;
  }
  return { count };
}

export function taskNotificationAckKeys(item: any): BadgeAckKey[] {
  const keys: BadgeAckKey[] = [];
  const pending = Number(item?.pending_interactions ?? 0);
  if (Number.isFinite(pending) && pending > 0) keys.push(taskInteractionAckKey(item));
  if ((item?.task ?? item)?.status === "failed") keys.push(taskFailedAckKey(item));
  const evaluation = item?.evaluation;
  if (evaluation?.verdict === "rejected") keys.push(evaluationRejectedAckKey(evaluation));
  return keys;
}

let badgeAcks = new Set<string>(loadBadgeAckKeys());
let pendingBadgeCount = 0;
let badgePushQueued = false;

function persistBadgeAcks(): void {
  saveBadgeAckKeys(badgeAcks);
}

function pushBadgeProjection(count: number): void {
  pendingBadgeCount = count;
  if (badgePushQueued) return;
  badgePushQueued = true;
  queueMicrotask(() => {
    badgePushQueued = false;
    const next = pendingBadgeCount;
    void setDockBadge(next);
    void setTrayAttention(next > 0);
  });
}

function addTaskNotificationAcks(item: any): boolean {
  let changed = false;
  for (const key of taskNotificationAckKeys(item)) {
    if (!badgeAcks.has(key)) {
      badgeAcks.add(key);
      changed = true;
    }
  }
  return changed;
}

function ackVisibleSelectedTaskNotifications(tasks: any[]): void {
  const selectedTaskID = activeTaskID();
  if (!selectedTaskID || isMissionPage() || !windowFocused()) return;
  const item = tasks.find((entry: any) => entry?.task?.id === selectedTaskID);
  if (!item || !addTaskNotificationAcks(item)) return;
  persistBadgeAcks();
}

export function recomputeBadgeFromTasks(tasks: any[] = boardStore.tasks): BadgeProjection {
  ackVisibleSelectedTaskNotifications(tasks);
  const projection = computeBadge(tasks, badgeAcks);
  pushBadgeProjection(projection.count);
  return projection;
}

export function ackBadge(key: BadgeAckKey): BadgeProjection {
  badgeAcks.add(key);
  persistBadgeAcks();
  return recomputeBadgeFromTasks();
}

export function ackTaskNotification(taskID: string): BadgeProjection {
  const item = boardStore.tasks.find((entry: any) => entry?.task?.id === taskID);
  if (!item) throw new Error(`ackTaskNotification: task ${taskID} is missing from task summary`);
  if (addTaskNotificationAcks(item)) persistBadgeAcks();
  return recomputeBadgeFromTasks();
}

export function ackTaskNotificationIfPresent(taskID: string): BadgeProjection | undefined {
  const item = boardStore.tasks.find((entry: any) => entry?.task?.id === taskID);
  if (!item) return undefined;
  if (addTaskNotificationAcks(item)) persistBadgeAcks();
  return recomputeBadgeFromTasks();
}

export function taskHasUnreadNotification(item: any): boolean {
  return taskNotificationAckKeys(item).some((key) => !badgeAcks.has(key));
}

export function replaceBadgeAcksForTest(keys: Iterable<string>): void {
  badgeAcks = new Set(keys);
  persistBadgeAcks();
}

setTaskListProjectionHandler((tasks) => {
  recomputeBadgeFromTasks(tasks);
});

// W2-V34: primeNotificationPermission() removed. Permission prompting now
// only goes through ensureDesktopNotificationPermission() from the Settings
// toggle. Lifecycle event handlers keep using the read-only permission path
// so startup and task events do not prompt.
