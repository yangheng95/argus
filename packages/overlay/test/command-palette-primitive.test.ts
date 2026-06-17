import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const SOURCE = readFileSync(path.resolve(import.meta.dir, "..", "src", "components", "CommandPalette.tsx"), "utf8")

test("CommandPalette uses the shared Dialog primitive for the modal shell", () => {
  expect(SOURCE).toContain('import { Dialog } from "./primitives/Dialog"')
  expect(SOURCE).toContain("<Dialog")
  expect(SOURCE).toContain('class="cmdk-dialog"')
  expect(SOURCE).toContain('overlayClass="cmdk-backdrop"')
  expect(SOURCE).toContain('formClass="cmdk-panel"')
  expect(SOURCE).toContain('headerClass="cmdk-header"')
  expect(SOURCE).not.toContain("@kobalte/core/dialog")
  expect(SOURCE).not.toContain("KobalteDialog.")
  expect(SOURCE).not.toContain('role="dialog"')
  expect(SOURCE).not.toContain("<dialog")
  expect(SOURCE).not.toContain("showModal()")
})

test("CommandPalette keeps shared disclosure and hotkey ownership", () => {
  expect(SOURCE).toContain("useDisclosure()")
  expect(SOURCE).toContain("useHotkey({")
  expect(SOURCE).toContain("cmdOrCtrl: true")
  expect(SOURCE).toContain('palette.open() || !document.querySelector(".dialog")')
  expect(SOURCE).toContain("priorFocus.focus()")
  expect(SOURCE).toContain("onOpenAutoFocus")
  expect(SOURCE).toContain("inputRef?.focus()")
  expect(SOURCE).toContain("onCloseAutoFocus")
})

test("CommandPalette links the focused search input to the active listbox option", () => {
  expect(SOURCE).toContain('role="combobox"')
  expect(SOURCE).toContain('aria-autocomplete="list"')
  expect(SOURCE).toContain("COMMAND_PALETTE_LISTBOX_ID")
  expect(SOURCE).toContain("aria-controls={COMMAND_PALETTE_LISTBOX_ID}")
  expect(SOURCE).toContain("aria-activedescendant={activeDescendantID()}")
  expect(SOURCE).toContain('role="listbox"')
  expect(SOURCE).toContain('role="option"')
  expect(SOURCE).toContain("id={commandOptionID(cmd, i())}")
})
