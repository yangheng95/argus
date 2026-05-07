import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = readFileSync(join(import.meta.dir, "../src/components/NotificationCenter.tsx"), "utf8");
const STYLES = readFileSync(join(import.meta.dir, "../src/styles/surfaces/notifications.css"), "utf8");

test("NotificationCenter routes dismiss control through the Button primitive", () => {
  expect(SOURCE).toContain('import { Button } from "./ui/Button";');
  expect(SOURCE).toContain('data-ui="app-notification-close"');
  expect(SOURCE).not.toContain('class="app-notification__close"');
  expect(STYLES).toContain('.app-notification .oc-button[data-ui="app-notification-close"]');
  expect(STYLES).not.toContain(".app-notification__close");
});
