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
    const prompt = await readFile(path.join(tuiRoot, "component/prompt/index.tsx"), "utf8")
    const sessionRoute = await readFile(path.join(tuiRoot, "routes/session/index.tsx"), "utf8")
    const sidebar = await readFile(path.join(tuiRoot, "routes/session/sidebar.tsx"), "utf8")
    const internal = await readFile(path.join(tuiRoot, "plugin/internal.ts"), "utf8")
    const local = await readFile(path.join(tuiRoot, "context/local.tsx"), "utf8")
    const homeTips = await readFile(path.join(tuiRoot, "feature-plugins/home/tips.tsx"), "utf8")
    const homeFooter = await readFile(path.join(tuiRoot, "feature-plugins/home/footer.tsx"), "utf8")
    const whichKey = await readFile(path.join(tuiRoot, "feature-plugins/system/which-key.tsx"), "utf8")
    const pluginManager = await readFile(path.join(tuiRoot, "feature-plugins/system/plugins.tsx"), "utf8")
    const notifications = await readFile(path.join(tuiRoot, "feature-plugins/system/notifications.ts"), "utf8")
    const diffViewer = await readFile(path.join(tuiRoot, "feature-plugins/system/diff-viewer.tsx"), "utf8")
    const diffViewerTree = await readFile(
      path.join(tuiRoot, "feature-plugins/system/diff-viewer-file-tree.tsx"),
      "utf8",
    )
    const diffViewerTreeUtils = await readFile(
      path.join(tuiRoot, "feature-plugins/system/diff-viewer-file-tree-utils.ts"),
      "utf8",
    )
    const sessionSwitcher = await readFile(path.join(tuiRoot, "feature-plugins/session/index.tsx"), "utf8")
    const sessionSwitcherDialog = await readFile(path.join(tuiRoot, "feature-plugins/session/dialog.tsx"), "utf8")
    const sessionPreviewPane = await readFile(path.join(tuiRoot, "feature-plugins/session/preview-pane.tsx"), "utf8")
    const sessionUtil = await readFile(path.join(tuiRoot, "feature-plugins/session/util.tsx"), "utf8")
    const keybind = await readFile(path.join(tuiRoot, "config/keybind.ts"), "utf8")
    const pluginApi = await readFile(path.join(projectRoot, "../plugin/src/tui.ts"), "utf8")
    const serverRoutes = await readFile(path.join(projectRoot, "src/server/routes/app.ts"), "utf8")
    const sdk = await readFile(path.join(projectRoot, "../sdk/js/src/gen/sdk.gen.ts"), "utf8")

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
    expect(home).toContain('name="home_prompt_right"')
    expect(home).toContain("placeholders={placeholder}")
    expect(home).toContain("promptMaxWidth")
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
      "DiffViewer",
      "SessionSwitcher",
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
    expect(prompt).toContain("right?: JSX.Element")
    expect(prompt).toContain("placeholders?:")
    expect(prompt).toContain("props.placeholders?.normal")
    expect(prompt).toContain("props.placeholders?.shell")
    expect(prompt).toContain("props.right")
    expect(prompt).toContain("tuiConfig.prompt?.max_height")
    expect(sessionRoute).toContain('name="session_prompt"')
    expect(sessionRoute).toContain('name="session_prompt_right"')
    expect(sessionRoute).toContain("promptVisible")
    expect(sessionRoute).toContain("promptDisabled")
    expect(diffViewer).toContain('id: "diff-viewer"')
    expect(diffViewer).toContain("api.route.register")
    expect(diffViewer).toContain('name: "diff.open"')
    expect(diffViewer).toContain("props.api.client.vcs.diff")
    expect(diffViewer).toContain("props.api.client.session.diff")
    expect(diffViewer).toContain("DiffViewerFileTree")
    expect(diffViewer).not.toContain("@opencode-ai")
    expect(diffViewerTree).toContain("DiffViewerFileTree")
    expect(diffViewerTreeUtils).toContain("buildFileTree")
    expect(diffViewerTreeUtils).toContain("movePatchFileIndex")
    expect(sessionSwitcher).toContain('id = "internal:session-switcher"')
    expect(sessionSwitcher).toContain('name: "session.list"')
    expect(sessionSwitcherDialog).toContain("SessionPreviewPane")
    expect(sessionSwitcherDialog).toContain("local.session.togglePin")
    expect(sessionSwitcherDialog).toContain("local.session.slots")
    expect(sessionSwitcherDialog).not.toContain("useProject")
    expect(sessionSwitcherDialog).not.toContain("DialogSessionDeleteFailed")
    expect(sessionPreviewPane).toContain("prefetchPreviews")
    expect(sessionPreviewPane).toContain(".messages({")
    expect(sessionUtil).toContain("extractMessageMarkdown")
    expect(sessionUtil).not.toContain("@opencode-ai")
    expect(local).toContain("sessionStore")
    expect(local).toContain("quickSwitch(slot: number)")
    expect(local).toContain('sdk.event.on("session.deleted"')
    expect(app).toContain("local.session.quickSwitch")
    expect(app).not.toContain("DialogSessionList")
    expect(existsSync(path.join(tuiRoot, "component/dialog-session-list.tsx"))).toBe(false)
    expect(keybind).toContain("diff_toggle_file_tree")
    expect(keybind).toContain('"diff.toggle_file_tree"')
    expect(keybind).toContain("session_quick_switch_9")
    expect(keybind).toContain('"session.quick_switch.9"')
    expect(pluginApi).toContain("export type VcsFileDiff")
    expect(pluginApi).toContain("TuiSessionDiffItem")
    expect(pluginApi).toContain("FilePart")
    expect(pluginApi).toContain("AgentPart")
    expect(pluginApi).toContain("TextPart")
    expect(pluginApi).toContain('Omit<FilePart, "id" | "messageID" | "sessionID">')
    expect(serverRoutes).toContain('operationId: "vcs.diff"')
    expect(serverRoutes).toContain('"/vcs/diff"')
    expect(sdk).toContain("public diff<ThrowOnError")
    expect(sdk).toContain('url: "/vcs/diff"')
  })
})
