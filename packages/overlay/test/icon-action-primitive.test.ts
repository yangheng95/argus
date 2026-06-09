import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const BUTTON_CSS = readFileSync(join(import.meta.dir, "../src/styles/primitives/button.css"), "utf8")
const CHAT_COMPOSER = readFileSync(join(import.meta.dir, "../src/components/ChatComposer.tsx"), "utf8")
const TASK_LIST = readFileSync(join(import.meta.dir, "../src/components/TaskList.tsx"), "utf8")
const PROVIDERS = readFileSync(join(import.meta.dir, "../src/components/settings/ProvidersPanel.tsx"), "utf8")
const NOTIFICATIONS = readFileSync(join(import.meta.dir, "../src/components/NotificationCenter.tsx"), "utf8")
const WINDOW_CONTROLS = readFileSync(join(import.meta.dir, "../src/components/WindowControls.tsx"), "utf8")

test("button primitive exposes a shared icon-action chrome contract", () => {
  expect(BUTTON_CSS).toContain('[data-chrome="icon-action"]')
  expect(BUTTON_CSS).toContain("--oc-button-color: var(--text-soft);")
  expect(BUTTON_CSS).toContain("--oc-button-shadow:")
})

test("high-frequency icon actions opt into the shared icon-action chrome", () => {
  for (const source of [CHAT_COMPOSER, TASK_LIST, PROVIDERS, NOTIFICATIONS]) {
    expect(source).toContain('data-chrome="icon-action"')
  }
})

test("window controls opt into the dedicated window-control chrome contract", () => {
  expect(BUTTON_CSS).toContain('[data-chrome="window-control"]')
  expect(WINDOW_CONTROLS).toContain('data-chrome="window-control"')
})
