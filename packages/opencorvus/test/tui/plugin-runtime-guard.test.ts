import { describe, expect, test } from "bun:test"
import { existsSync } from "fs"
import { readFile } from "fs/promises"
import path from "path"
import { createBindingLookup } from "@opencorvus-ai/plugin/tui"
import { createCommandShim } from "../../src/cli/cmd/tui/plugin/command-shim"
import * as TuiKeybind from "../../src/cli/cmd/tui/config/keybind"

const projectRoot = path.join(import.meta.dir, "../..")
const tuiRoot = path.join(projectRoot, "src/cli/cmd/tui")

describe("OpenCode-derived TUI plugin substrate", () => {
  test("exports the OpenCode TUI API surface from the plugin package", () => {
    const lookup = createBindingLookup({
      command_list: "ctrl+p",
    })

    expect(existsSync(path.join(projectRoot, "../plugin/src/tui.ts"))).toBe(true)
    expect(lookup.get("command_list")[0]?.key).toBe("ctrl+p")
  })

  test("keeps legacy v1 plugin commands routed through the OpenTUI keymap shim", () => {
    const registered: Array<{ commands?: unknown[]; bindings?: unknown[] }> = []
    const dispatched: string[] = []
    const keymap = {
      registerLayer(layer: { commands?: unknown[]; bindings?: unknown[] }) {
        registered.push(layer)
        return () => {
          registered.length = 0
        }
      },
      dispatchCommand(command: string) {
        dispatched.push(command)
      },
    }
    const dialog = {
      stack: [],
      size: "medium" as const,
      replace() {},
      clear() {},
      setSize() {},
    }
    const keybinds = TuiKeybind.createLookup(TuiKeybind.parse({ session_list: "<leader>l" }))

    const command = createCommandShim(keymap as never, dialog as never, keybinds)
    const unregister = command?.register(() => [
      {
        title: "Switch session",
        value: "plugin.session.switch",
        keybind: "session_list",
        slash: { name: "switch" },
      },
    ])

    expect(registered).toHaveLength(1)
    expect(JSON.stringify(registered[0])).toContain("plugin.session.switch")
    expect(JSON.stringify(registered[0])).toContain("<leader>l")

    command?.trigger("plugin.session.switch")
    command?.show()
    expect(dispatched).toEqual(["plugin.session.switch", "command.palette.show"])

    unregister?.()
    expect(registered).toHaveLength(0)
  })

  test("wires the TUI app through plugin runtime and host slots instead of hard-coded sidebars", async () => {
    const app = await readFile(path.join(tuiRoot, "app.tsx"), "utf8")
    const route = await readFile(path.join(tuiRoot, "context/route.tsx"), "utf8")
    const runtime = await readFile(path.join(tuiRoot, "plugin/runtime.ts"), "utf8")
    const slots = await readFile(path.join(tuiRoot, "plugin/slots.tsx"), "utf8")

    expect(app).toContain('from "./plugin/api"')
    expect(app).toContain('from "./plugin/runtime"')
    expect(app).toContain("TuiPluginRuntime.init")
    expect(app).toContain('<TuiPluginRuntime.Slot name="app_bottom" />')
    expect(app).toContain('<TuiPluginRuntime.Slot name="app" />')
    expect(route).toContain('type: "plugin"')
    expect(runtime).toContain("createScopedKeymap")
    expect(runtime).toContain("scope.track(host.register")
    expect(slots).toContain("createSolidSlotRegistry")
    expect(slots).toContain("createSlot")
  })
})
