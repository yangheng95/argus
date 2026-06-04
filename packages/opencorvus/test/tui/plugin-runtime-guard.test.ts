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
    const home = await readFile(path.join(tuiRoot, "routes/home.tsx"), "utf8")
    const sidebar = await readFile(path.join(tuiRoot, "routes/session/sidebar.tsx"), "utf8")
    const internal = await readFile(path.join(tuiRoot, "plugin/internal.ts"), "utf8")
    const homeTips = await readFile(path.join(tuiRoot, "feature-plugins/home/tips.tsx"), "utf8")
    const homeFooter = await readFile(path.join(tuiRoot, "feature-plugins/home/footer.tsx"), "utf8")
    const whichKey = await readFile(path.join(tuiRoot, "feature-plugins/system/which-key.tsx"), "utf8")
    const pluginManager = await readFile(path.join(tuiRoot, "feature-plugins/system/plugins.tsx"), "utf8")
    const notifications = await readFile(path.join(tuiRoot, "feature-plugins/system/notifications.ts"), "utf8")

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
    expect(home).toContain('name="home_logo"')
    expect(home).toContain('name="home_prompt"')
    expect(home).toContain('name="home_bottom"')
    expect(home).toContain('name="home_footer"')
    expect(home).not.toContain("Tips />")
    expect(home).not.toContain("useDirectory")
    expect(home).not.toContain("sync.data.mcp")
    expect(existsSync(path.join(tuiRoot, "component/tips.tsx"))).toBe(false)
    expect(sidebar).toContain('name="sidebar_title"')
    expect(sidebar).toContain('name="sidebar_content"')
    expect(sidebar).toContain('name="sidebar_footer"')
    expect(sidebar).not.toContain("TodoItem")
    expect(sidebar).not.toContain("sync.data.mcp")
    expect(sidebar).not.toContain("sync.data.lsp")
    expect(sidebar).not.toContain("session_diff")
    for (const plugin of [
      "SidebarContext",
      "HomeFooter",
      "HomeTips",
      "SidebarMcp",
      "SidebarLsp",
      "SidebarTodo",
      "SidebarFiles",
      "SidebarFooter",
      "Notifications",
      "PluginManager",
      "WhichKey",
    ]) {
      expect(internal).toContain(plugin)
    }
    expect(whichKey).toContain('toggle: "which-key.toggle"')
    expect(whichKey).toContain('app_bottom()')
    expect(whichKey).toContain('app()')
    expect(pluginManager).toContain("props.api.plugins.list()")
    expect(pluginManager).toContain("props.api.plugins.deactivate")
    expect(pluginManager).toContain("props.api.plugins.activate")
    expect(notifications).toContain('api.event.on("question.asked"')
    expect(notifications).toContain('api.event.on("permission.asked"')
    expect(notifications).toContain('api.event.on("session.status"')
    expect(homeTips).toContain('home_bottom()')
    expect(homeTips).toContain('name: "tips.toggle"')
    expect(homeFooter).toContain('home_footer()')
  })
})
