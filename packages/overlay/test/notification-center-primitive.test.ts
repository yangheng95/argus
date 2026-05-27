import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = readFileSync(join(import.meta.dir, "../src/components/NotificationCenter.tsx"), "utf8");
const STYLES = readFileSync(join(import.meta.dir, "../src/styles/surfaces/notifications.css"), "utf8");
const MAIN = readFileSync(join(import.meta.dir, "../src/main.tsx"), "utf8");

test("NotificationCenter routes dismiss control through the Button primitive", () => {
  expect(SOURCE).toContain('import { Button } from "./ui/Button";');
  expect(SOURCE).toContain('data-ui="app-notification-close"');
  expect(SOURCE).not.toContain('class="app-notification__close"');
  expect(STYLES).toContain('.app-notification .oc-button[data-ui="app-notification-close"]');
  expect(STYLES).not.toContain(".app-notification__close");
});

test("NotificationCenter routes task notification activation through task selection", () => {
  expect(SOURCE).toContain("activateTaskNotification");
  expect(SOURCE).toContain("await selectTask(item.taskID)");
  expect(SOURCE).toContain("await loadTasks()");
  expect(SOURCE).not.toContain("ackTaskNotification(item.taskID)");
  expect(SOURCE).toContain("dismissNotification(item.id)");
  expect(SOURCE).toContain('data-clickable={item.taskID ? "true" : undefined}');
});

test("NotificationCenter exposes a copy control whenever details exist", () => {
  const copyIndex = SOURCE.indexOf('data-ui="app-notification-details-copy"');
  const detailsBodyIndex = SOURCE.indexOf('class="app-notification__details-body"');
  expect(copyIndex).toBeGreaterThan(-1);
  expect(detailsBodyIndex).toBeGreaterThan(-1);
  expect(copyIndex).toBeLessThan(detailsBodyIndex);
});

test("foregrounding the overlay recomputes the notification projection", () => {
  expect(MAIN).toContain("recomputeBadgeFromTasks");
  expect(MAIN).toContain('window.addEventListener("focus"');
  expect(MAIN).toContain('document.addEventListener(\n  "visibilitychange"');
});
