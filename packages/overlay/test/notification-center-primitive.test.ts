import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const SOURCE = readFileSync(join(import.meta.dir, "../src/components/NotificationCenter.tsx"), "utf8")
const STYLES = readFileSync(join(import.meta.dir, "../src/styles/surfaces/notifications.css"), "utf8")
const MAIN = readFileSync(join(import.meta.dir, "../src/main.tsx"), "utf8")
const APP = readFileSync(join(import.meta.dir, "../src/components/App.tsx"), "utf8")
const NOTIFY = readFileSync(join(import.meta.dir, "../src/services/notify.ts"), "utf8")
const EVENTS = readFileSync(join(import.meta.dir, "../src/services/events.ts"), "utf8")
const SSE = readFileSync(join(import.meta.dir, "../src/services/sse.ts"), "utf8")

function cssRuleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = STYLES.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`))
  if (!match) throw new Error(`missing CSS rule: ${selector}`)
  return match[1]!
}

test("NotificationCenter routes dismiss control through the Button primitive", () => {
  expect(SOURCE).toContain('import { Button } from "./ui/Button"')
  expect(SOURCE).toContain('data-ui="app-notification-close"')
  expect(SOURCE).not.toContain('class="app-notification__close"')
  expect(STYLES).toContain('.app-notification .oc-button[data-ui="app-notification-close"]')
  expect(STYLES).not.toContain(".app-notification__close")
})

test("NotificationCenter routes task notification activation through task selection", () => {
  expect(SOURCE).toContain("activateTaskNotification")
  expect(SOURCE).toContain("if (!item.taskDirectory)")
  expect(SOURCE).toContain("await selectTask(item.taskID, { directory: item.taskDirectory })")
  expect(SOURCE).toContain("await loadTasks()")
  expect(SOURCE).not.toContain("ackTaskNotification(item.taskID)")
  expect(SOURCE).toContain("dismissNotification(item.id)")
  expect(SOURCE).toContain('data-ui="app-notification-open-task"')
  expect(SOURCE).toContain('title={`${t("common.open")}: ${taskTitle()}`}')
  expect(SOURCE).toContain("taskDirectory: item.taskDirectory")
  expect(SOURCE).toContain("taskTitle: item.taskTitle")
  expect(SOURCE).toContain("runTaskNotificationAction")
  expect(SOURCE).toContain("onClick={() => runTaskNotificationAction(props.item)}")
  expect(SOURCE).toContain("props.item.taskID && props.item.taskDirectory")
  expect(SOURCE).not.toContain("data-clickable={")
  expect(SOURCE).not.toContain("tabIndex={props.item.taskID")
  expect(SOURCE).not.toContain("onKeyDown={(event)")
  expect(STYLES).toContain(".app-notification__actions")
  expect(STYLES).toContain(".app-notification__actions .oc-button")
})

test("NotificationCenter task action precedes detail controls without nesting buttons", () => {
  const itemStart = SOURCE.indexOf("function NotificationItem")
  const centerStart = SOURCE.indexOf("export function NotificationCenter")
  const itemSource = SOURCE.slice(itemStart, centerStart)
  const sectionIndex = itemSource.indexOf('<section\n      class="app-notification"')
  const openIndex = itemSource.indexOf('data-ui="app-notification-open-task"')
  const detailsIndex = itemSource.indexOf("<NotificationDetails")
  const closeIndex = itemSource.indexOf('data-ui="app-notification-close"')
  expect(sectionIndex).toBeGreaterThan(-1)
  expect(openIndex).toBeGreaterThan(sectionIndex)
  expect(detailsIndex).toBeGreaterThan(openIndex)
  expect(closeIndex).toBeGreaterThan(openIndex)
  expect(itemSource).not.toContain("event.stopPropagation()")
})

test("NotificationCenter exposes a copy control whenever details exist", () => {
  const copyIndex = SOURCE.indexOf('data-ui="app-notification-details-copy"')
  const detailsBodyIndex = SOURCE.indexOf('class="app-notification__details-body"')
  expect(copyIndex).toBeGreaterThan(-1)
  expect(detailsBodyIndex).toBeGreaterThan(-1)
  expect(copyIndex).toBeLessThan(detailsBodyIndex)
})

test("NotificationCenter details actions wrap inside narrow panels", () => {
  expect(STYLES).toMatch(/\.app-notification__details-actions\s*\{[\s\S]*min-width:\s*0;/)
  expect(STYLES).toMatch(/\.app-notification__details-actions\s*\{[\s\S]*flex-wrap:\s*wrap;/)
  expect(STYLES).toMatch(/\.app-notification__details-actions \.oc-button\s*\{[\s\S]*max-width:\s*100%;/)
})

test("NotificationCenter separates toast visibility from task-grouped panel history", () => {
  expect(SOURCE).toContain('type NotificationSurface = "toast" | "panel"')
  expect(SOURCE).toContain("visibleNotificationItems()")
  expect(SOURCE).toContain("centerHistoryNotificationItems()")
  expect(SOURCE).toContain("groupByTask")
  expect(SOURCE).toContain("title: item.taskID ? item.taskTitle : t(\"notify.system_group\")")
  expect(SOURCE).toContain("props.item.taskTitle")
  expect(SOURCE).not.toContain("notificationTaskTitle")
  expect(SOURCE).toContain('t("notify.system_group")')
  expect(SOURCE).toContain("data-surface={surface()}")
  expect(SOURCE).toContain('class="app-notification-group"')
  expect(SOURCE).toContain('class="app-notification-empty"')
  expect(STYLES).toContain('.app-notifications[data-surface="toast"]')
  expect(STYLES).toContain('.app-notifications[data-surface="panel"]')
  expect(STYLES).toContain("padding: 0;")
  expect(STYLES).toContain(".app-notification-group__header")
  expect(NOTIFY).toContain("dismissedAt: number")
  expect(NOTIFY).toContain("centerHistory: boolean")
  expect(NOTIFY).toContain("taskDirectory: string")
  expect(NOTIFY).toContain("taskTitle: string")
  expect(NOTIFY).toContain("notificationTaskDirectory")
  expect(NOTIFY).toContain("taskTitle,")
  expect(NOTIFY).toContain("taskDirectory: typeof event.directory ===")
  expect(EVENTS).toContain("handleTaskListNotification(event: any, options: { directory?: string } = {})")
  expect(EVENTS).toContain("routeNotification({ ...event, type, directory: options.directory ?? event?.directory })")
  expect(SSE).toContain("handleTaskListNotification(event, { directory })")
  expect(NOTIFY).toContain("MAX_NOTIFICATION_HISTORY")
  expect(NOTIFY).toContain("visibleNotificationItems")
  expect(NOTIFY).toContain("centerHistoryNotificationItems")
})

test("notification panel stretches the shared list and cards to the panel width", () => {
  const panelRootRule = cssRuleBody('.app-notifications[data-surface="panel"]')
  const mountRule = cssRuleBody(".notification-center-panel")
  const portalChildRule = cssRuleBody(".notification-center-panel > *")
  const cardRule = cssRuleBody(".app-notification")
  const groupRule = cssRuleBody(".app-notification-group")
  const groupItemsRule = cssRuleBody(".app-notification-group__items")
  const toastRule = cssRuleBody('.app-notifications[data-surface="toast"]')

  for (const body of [panelRootRule, mountRule, portalChildRule, cardRule, groupRule, groupItemsRule]) {
    expect(body).toContain("width: 100%;")
    expect(body).toContain("max-width: 100%;")
    expect(body).toContain("min-width: 0;")
  }
  expect(panelRootRule).toContain("flex: 1 1 0;")
  expect(portalChildRule).toContain("flex: 1 1 0;")
  expect(cardRule).toContain("box-sizing: border-box;")
  expect(toastRule).toContain("width: min(")
  expect(toastRule).toContain("right: calc(64px")
  expect(toastRule).toContain("top: calc(")
  expect(toastRule).not.toContain("bottom:")
  expect(toastRule).not.toContain("width: 100%;")
})

test("dismissed notification history keeps readable text without whole-card opacity", () => {
  expect(SOURCE).toContain('data-dismissed={props.item.dismissedAt > 0 ? "true" : "false"}')
  const dismissedRule = cssRuleBody('.app-notification[data-dismissed="true"]')
  expect(dismissedRule).not.toMatch(/(?<!-)\bopacity\s*:/)
  expect(dismissedRule).toContain("color-mix(in srgb, var(--surface-strong)")
  expect(STYLES).toContain('.app-notification[data-dismissed="true"] .app-notification__mark')
})

test("NotificationCenter waits for the loaded i18n bundle before translating", () => {
  expect(SOURCE).toContain('import { appStore } from "../store/app"')
  expect(SOURCE).toContain("when={appStore.i18nReady}")
  expect(SOURCE).toContain('fallback={<div class="app-notifications"')
  expect(SOURCE.indexOf("when={appStore.i18nReady}")).toBeLessThan(
    SOURCE.indexOf('aria-label={t("notify.center_label")}'),
  )
})

test("main preloads i18n before mounting translated Solid surfaces", () => {
  expect(MAIN).toContain('import { loadAllLocales, localeTag, setLocale } from "./utils/i18n"')
  expect(MAIN.indexOf("await loadAllLocales()")).toBeLessThan(
    MAIN.indexOf('render(() => <NotificationCenter surface="toast" />'),
  )
  expect(MAIN.indexOf("await setLocale(localeTag())")).toBeLessThan(
    MAIN.indexOf('document.getElementById("workLedgerPanel")'),
  )
})

test("main keeps the early toast root and App owns the workbench notification center", () => {
  expect(MAIN).toContain('<NotificationCenter surface="toast" />')
  expect(MAIN).not.toContain('document.getElementById("solidNotificationCenterMount")')
  expect(MAIN).not.toContain('<NotificationCenter surface="panel" />')
  expect(APP).toContain('id="solidNotificationCenterMount"')
  expect(APP).toContain('<NotificationCenter surface="panel" />')
  expect(MAIN).toContain('id: "notifications"')
  expect(MAIN).toContain('icon: "notifications"')
  expect(MAIN).toContain('labelKey: "notify.center_label"')
  expect(MAIN).toContain('notifications: document.getElementById("centerWorkbenchNotifications")')
})

test("toast surface is hidden while the notification panel is open", () => {
  expect(MAIN).toContain("document.body.dataset.notificationsPanelOpen")
  expect(STYLES).toContain('body[data-notifications-panel-open="true"] .app-notifications[data-surface="toast"]')
  expect(STYLES).toMatch(
    /body\[data-notifications-panel-open="true"\] \.app-notifications\[data-surface="toast"\]\s*\{[\s\S]*display:\s*none;/,
  )
})

test("foregrounding the overlay recomputes the notification projection", () => {
  expect(MAIN).toContain("recomputeBadgeFromTasks")
  expect(MAIN).toContain('window.addEventListener("focus"')
  expect(MAIN).toContain('document.addEventListener(\n  "visibilitychange"')
})
