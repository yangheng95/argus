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

  test("keeps product Alt access keys outside handwritten menu roles", () => {
    expect(SOURCE).toContain("menuIDForAccessKey")
    expect(SOURCE).toContain("Alt+")
    expect(SOURCE).toContain("openFromKeyboard")
    expect(SOURCE).toContain("focusTrigger")
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
})
