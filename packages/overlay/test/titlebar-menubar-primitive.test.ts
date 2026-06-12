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
    expect(SOURCE).not.toContain('role="menubar"')
    expect(SOURCE).not.toContain('role="menu"')
    expect(SOURCE).not.toContain('role="menuitem"')
    expect(SOURCE).not.toContain('aria-haspopup="menu"')
    expect(SOURCE).not.toContain('document.addEventListener("pointerdown"')
  })

  test("keeps product Alt access keys outside handwritten menu roles", () => {
    expect(SOURCE).toContain("menuIDForAccessKey")
    expect(SOURCE).toContain("Alt+")
    expect(SOURCE).toContain("openFromKeyboard")
    expect(SOURCE).toContain("focusTrigger")
  })

  test("styles Kobalte disabled item state", () => {
    expect(CSS).toContain(".titlebar-menubar-item[data-disabled]")
    expect(CSS).toContain(":not([data-disabled])")
  })
})
