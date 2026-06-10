import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const SOURCE = readFileSync(path.resolve(import.meta.dir, "..", "src", "components", "CommandPalette.tsx"), "utf8")

test("CommandPalette uses Kobalte dialog content for the modal shell", () => {
  expect(SOURCE).toContain('import * as Dialog from "@kobalte/core/dialog"')
  expect(SOURCE).toContain("<Dialog.Root")
  expect(SOURCE).toContain("<Dialog.Portal")
  expect(SOURCE).toContain("<Dialog.Content")
  expect(SOURCE).toContain('class="cmdk-backdrop"')
  expect(SOURCE).toContain('class="cmdk-panel"')
  expect(SOURCE).toContain('aria-modal="true"')
  expect(SOURCE).not.toContain('role="dialog"')
  expect(SOURCE).not.toContain("<dialog")
  expect(SOURCE).not.toContain("showModal()")
})

test("CommandPalette keeps shared disclosure and hotkey ownership", () => {
  expect(SOURCE).toContain("useDisclosure()")
  expect(SOURCE).toContain("useHotkey({")
  expect(SOURCE).toContain("cmdOrCtrl: true")
  expect(SOURCE).toContain("priorFocus.focus()")
  expect(SOURCE).toContain("onOpenAutoFocus")
  expect(SOURCE).toContain("inputRef?.focus()")
  expect(SOURCE).toContain("onCloseAutoFocus")
})
