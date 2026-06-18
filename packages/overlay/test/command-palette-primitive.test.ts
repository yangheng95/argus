import { expect, test } from "bun:test"
import { readFileSync, readdirSync, statSync } from "node:fs"
import path, { join, relative } from "node:path"

const SOURCE = readFileSync(path.resolve(import.meta.dir, "..", "src", "components", "CommandPalette.tsx"), "utf8")
const COMPONENTS_ROOT = join(import.meta.dir, "..", "src/components")
const COMBOBOX_CONTROL_PATH = join(COMPONENTS_ROOT, "ui/ComboboxControl.tsx")
const COMBOBOX_SOURCE = readFileSync(COMBOBOX_CONTROL_PATH, "utf8")

function walkTsx(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walkTsx(full))
    else if (entry.endsWith(".tsx")) out.push(full)
  }
  return out
}

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

test("CommandPalette delegates command input and listbox semantics to ComboboxControl", () => {
  expect(SOURCE).toContain('import { ComboboxControl } from "./ui/ComboboxControl"')
  expect(SOURCE).toContain('import { formatErrorDetails, notifyError } from "../services/notify"')
  expect(SOURCE).toContain("<ComboboxControl<Command>")
  expect(SOURCE).toContain("defaultFilter={commandMatches}")
  expect(SOURCE).toContain("onChange={runCommand}")
  expect(SOURCE).toContain("value={null}")
  expect(SOURCE).toContain("onOpenChange={(open) =>")
  expect(SOURCE).not.toContain("@kobalte/core/combobox")
  expect(SOURCE).not.toContain("@kobalte/core/listbox")
  expect(SOURCE).not.toContain("setQuery")
  expect(SOURCE).not.toContain("focusFirstKey")
  expect(SOURCE).not.toContain("onInputChange={setQuery}")
  expect(SOURCE).not.toContain("console.error")
  expect(SOURCE).not.toContain("activeIndex")
  expect(SOURCE).not.toContain("commandOptionID")
  expect(SOURCE).not.toContain("activeDescendantID")
  expect(SOURCE).not.toContain("const filtered")
  expect(SOURCE).not.toContain("handleKeyDown")
  expect(SOURCE).not.toContain("aria-activedescendant")
  expect(SOURCE).not.toContain('role="listbox"')
  expect(SOURCE).not.toContain('role="option"')
  expect(SOURCE).not.toContain("cmdk-item--active")
})

test("ComboboxControl is the only Kobalte Combobox shell owner", () => {
  expect(COMBOBOX_SOURCE).toContain('import * as Combobox from "@kobalte/core/combobox"')
  expect(COMBOBOX_SOURCE).toContain("<Combobox.Root<T>")
  expect(COMBOBOX_SOURCE).toContain("<Combobox.Control")
  expect(COMBOBOX_SOURCE).toContain("<Combobox.Input")
  expect(COMBOBOX_SOURCE).toContain("<Combobox.Listbox")
  expect(COMBOBOX_SOURCE).toContain("onOpenChange={props.onOpenChange}")
  expect(COMBOBOX_SOURCE).toContain("context.inputValue()")
  expect(COMBOBOX_SOURCE).not.toContain("focusFirstKey")
  expect(COMBOBOX_SOURCE).toContain("<Combobox.Item")
  for (const file of walkTsx(COMPONENTS_ROOT)) {
    if (file === COMBOBOX_CONTROL_PATH) continue
    const source = readFileSync(file, "utf8")
    const rel = relative(COMPONENTS_ROOT, file).replace(/\\/g, "/")
    expect(source, rel).not.toContain('@kobalte/core/combobox"')
    expect(source, rel).not.toContain('import { Combobox } from "@kobalte/core"')
    expect(source, rel).not.toContain('@kobalte/core/src/combobox"')
    expect(source, rel).not.toContain('@kobalte/core/src/combobox/index"')
    expect(source, rel).not.toContain("<Combobox.Root")
    expect(source, rel).not.toContain("<Combobox.Input")
    expect(source, rel).not.toContain("<Combobox.Listbox")
    expect(source, rel).not.toContain("<Combobox.Item")
  }
})

test("CommandPalette derives settings commands from CONFIG_SECTIONS", () => {
  expect(SOURCE).toContain('import { CONFIG_SECTIONS } from "../store/dialog"')
  expect(SOURCE).toContain("for (const section of CONFIG_SECTIONS)")
  expect(SOURCE).toContain("openConfigDialog(section.id)")
  expect(SOURCE).not.toContain("SETTINGS_TABS")
  expect(SOURCE).not.toContain("switchConfigTab")
})
