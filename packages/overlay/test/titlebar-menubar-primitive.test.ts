import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const SOURCE = readFileSync(
  path.resolve(import.meta.dir, "..", "src", "components", "titlebar", "TitlebarMenubar.tsx"),
  "utf8",
)
const CSS = readFileSync(path.resolve(import.meta.dir, "..", "src", "styles", "surfaces", "titlebar.css"), "utf8")

describe("TitlebarMenubar primitive ownership", () => {
  test("delegates menubar semantics to Kobalte", () => {
    expect(SOURCE).toContain('import * as Menubar from "@kobalte/core/menubar"')
    expect(SOURCE).toContain("<Menubar.Root")
    expect(SOURCE).toContain("<Menubar.Menu")
    expect(SOURCE).toContain("<Menubar.Trigger")
    expect(SOURCE).toContain('import { Portal } from "solid-js/web"')
    expect(SOURCE).toContain("<Portal")
    expect(SOURCE).toContain("<Menubar.Content")
    expect(SOURCE).toContain("<Menubar.Item")
    expect(SOURCE).toContain("<Menubar.Group")
    expect(SOURCE).toContain("<Menubar.GroupLabel")
    expect(SOURCE).toContain("<Menubar.CheckboxItem")
    expect(SOURCE).toContain("<Menubar.RadioGroup")
    expect(SOURCE).toContain("<Menubar.RadioItem")
    expect(SOURCE).not.toMatch(/<[^>]+role="menubar"/)
    expect(SOURCE).not.toMatch(/<[^>]+role="menu"/)
    expect(SOURCE).not.toMatch(/<[^>]+role="menuitem"/)
    expect(SOURCE).not.toMatch(/<[^>]+role="radiogroup"/)
    expect(SOURCE).not.toMatch(/<[^>]+role="radio"/)
    expect(SOURCE).not.toContain('aria-haspopup="menu"')
    expect(SOURCE).not.toContain('document.addEventListener("pointerdown"')
  })

  test("routes visible top-level menu trigger chrome through Button", () => {
    expect(SOURCE).toContain('import { Button } from "../ui/Button"')
    expect(SOURCE).toContain("<Menubar.Trigger")
    expect(SOURCE).toContain("as={Button}")
    expect(SOURCE).toContain('variant="ghost"')
    expect(SOURCE).toContain('size="sm"')
    expect(SOURCE).toContain('tone="neutral"')
    expect(SOURCE).not.toContain('class="oc-button"')
    expect(SOURCE).not.toContain('data-variant="ghost"')
    expect(SOURCE).not.toContain('data-size="sm"')
    expect(SOURCE).not.toContain('data-tone="neutral"')
    expect(SOURCE).not.toContain('data-active={openMenu() === menu.id ? "true" : "false"}')
    expect(CSS).not.toContain(".titlebar-menubar-trigger")
    expect(CSS).toContain('.titlebar-menubar .oc-button[data-ui="titlebar-menubar-trigger"]')
    expect(CSS).toContain('.titlebar-menubar .oc-button[data-ui="titlebar-menubar-trigger"][data-expanded]')
    expect(CSS).not.toContain('.titlebar-menubar .oc-button[data-ui="titlebar-menubar-trigger"][data-active="true"]')
  })

  test("uses Kobalte Popper as the only titlebar menu positioning source", () => {
    expect(SOURCE).not.toContain("function setMenuAnchor")
    expect(SOURCE).not.toContain("function toggleMenuFromTrigger")
    expect(SOURCE).not.toContain("getBoundingClientRect")
    expect(SOURCE).not.toContain("--titlebar-menu-anchor-left")
    expect(SOURCE).not.toContain("titlebar-menu-viewport-shift")
    expect(SOURCE).not.toContain("onPointerDown={(event) => toggleMenuFromTrigger")
    expect(SOURCE).toContain("function toggleControlledMenuFromTrigger")
    expect(SOURCE).toContain("onPointerDown={(event) => toggleControlledMenuFromTrigger(event, menu.id)}")
    const pointerStart = SOURCE.indexOf("function toggleControlledMenuFromTrigger")
    const pointerEnd = SOURCE.indexOf("function menuTrigger", pointerStart)
    expect(pointerStart).toBeGreaterThan(0)
    expect(pointerEnd).toBeGreaterThan(pointerStart)
    const pointerHandler = SOURCE.slice(pointerStart, pointerEnd)
    expect(pointerHandler).toContain("setOpenMenu((current) => (current === id ? null : id))")
    expect(pointerHandler).toContain("event.preventDefault()")
    expect(pointerHandler).not.toContain("getBoundingClientRect")
    expect(pointerHandler).not.toContain("style.setProperty")
    expect(CSS).not.toContain("--titlebar-menu-anchor-left")
    expect(CSS).not.toContain("--titlebar-menu-viewport-shift")
    expect(CSS).toContain("width: min(calc(340px * var(--ui-scale)), calc(100cqw - calc(24px * var(--ui-scale))));")
    expect(CSS).toContain("width: min(calc(460px * var(--ui-scale)), calc(100cqw - calc(24px * var(--ui-scale))));")
  })

  test("keeps product Alt access keys outside handwritten menu roles", () => {
    expect(SOURCE).toContain("menuIDForAccessKey")
    expect(SOURCE).toContain("Alt+")
    expect(SOURCE).toContain("openFromKeyboard")
    expect(SOURCE).toContain("focusTrigger")
  })

  test("keeps the top-level menu order and removes the old Tools trigger", () => {
    expect(SOURCE).toContain('const MENU_IDS: MenuID[] = ["workspace", "provider", "run", "view", "settings", "help"]')
    expect(SOURCE).not.toContain('| "tools"')
    expect(SOURCE).not.toContain("MENU_ACCESS_KEYS.tools")
    expect(SOURCE).not.toContain('id: "tools"')
    expect(SOURCE).not.toContain('menu.id === "tools"')
    expect(SOURCE).not.toContain("titlebar.menu.tools")
  })

  test("focuses access-key menus by Kobalte roles instead of titlebar item classes", () => {
    expect(SOURCE).toContain("autoFocusMenu={autoFocusMenu()}")
    expect(SOURCE).toContain('[role="menuitemradio"][aria-checked="true"]:not([aria-disabled="true"])')
    expect(SOURCE).toContain('[role="menuitem"]:not([aria-disabled="true"])')
    expect(SOURCE).not.toContain("focusFirstMenuItem")
    expect(SOURCE).not.toContain(".titlebar-menubar-item:not([data-disabled])")
    expect(SOURCE).not.toContain("#titlebar-menu-${id}")
  })

  test("styles Kobalte disabled item state", () => {
    expect(CSS).toContain(".titlebar-menubar-item[data-disabled]")
    expect(CSS).toContain(":not([data-disabled])")
  })

  test("styles Kobalte highlighted theme radio items", () => {
    expect(CSS).toContain(".titlebar-theme-option[data-highlighted]")
  })

  test("routes Run menu boolean settings through Kobalte checkbox items", () => {
    expect(SOURCE).toContain("function MenuCheckboxItem")
    expect(SOURCE).toContain("<Menubar.CheckboxItem")
    expect(SOURCE).toContain('class="titlebar-menubar-item titlebar-menubar-checkbox"')
    expect(SOURCE).toContain("checked={props.checked}")
    expect(SOURCE).toContain("onChange={(checked) => void props.onChange(checked)}")
    expect(SOURCE).toContain('testid="titlebar-auto-question"')
    expect(SOURCE).toContain('testid="titlebar-auto-confirm-proposed-tasks"')
    expect(SOURCE).not.toContain('class="titlebar-menubar-toggle"')
    expect(SOURCE).not.toContain('type="checkbox"')
    expect(CSS).not.toContain(".titlebar-menubar-toggle")
    expect(CSS).not.toContain('input[type="checkbox"]')
    expect(CSS).toContain(".titlebar-menubar-checkbox[data-checked] .titlebar-menubar-checkbox-indicator")
  })

  test("styles Kobalte checked theme radio items without local active state", () => {
    expect(CSS).toContain(".titlebar-theme-option[data-checked]")
    expect(CSS).not.toContain('.titlebar-theme-option[data-active="true"]')
    expect(SOURCE).not.toContain("data-active={settingsStore.theme === item.id")
  })
})
