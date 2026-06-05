import { describe, expect, test } from "bun:test"
import { existsSync } from "fs"
import { readFile } from "fs/promises"
import path from "path"
import { createBindingLookup, type TuiPluginApi } from "@opencorvus-ai/plugin/tui"
import { RIGHT_SIDEBAR_CODING_ASSISTANT_SOURCE } from "../../src/coding-assistant/session"
import { createCommandShim } from "../../src/cli/cmd/tui/plugin/command-shim"
import * as TuiKeybind from "../../src/cli/cmd/tui/config/keybind"
import { showTasks } from "../../src/cli/cmd/tui/feature-plugins/sidebar/agent-team-actions"

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
    const bgPulse = await readFile(path.join(tuiRoot, "component/bg-pulse.tsx"), "utf8")
    const bgPulseRender = await readFile(path.join(tuiRoot, "component/bg-pulse-render.ts"), "utf8")
    const prompt = await readFile(path.join(tuiRoot, "component/prompt/index.tsx"), "utf8")
    const sessionRoute = await readFile(path.join(tuiRoot, "routes/session/index.tsx"), "utf8")
    const collapseToolOutput = await readFile(path.join(tuiRoot, "util/collapse-tool-output.ts"), "utf8")
    const pathFormat = await readFile(path.join(tuiRoot, "context/path-format.tsx"), "utf8")
    const thinking = await readFile(path.join(tuiRoot, "context/thinking.ts"), "utf8")
    const sessionFooter = await readFile(path.join(tuiRoot, "routes/session/footer.tsx"), "utf8")
    const sessionHeader = await readFile(path.join(tuiRoot, "routes/session/header.tsx"), "utf8")
    const dialogMessage = await readFile(path.join(tuiRoot, "routes/session/dialog-message.tsx"), "utf8")
    const subagentFooter = await readFile(path.join(tuiRoot, "routes/session/subagent-footer.tsx"), "utf8")
    const sidebar = await readFile(path.join(tuiRoot, "routes/session/sidebar.tsx"), "utf8")
    const internal = await readFile(path.join(tuiRoot, "plugin/internal.ts"), "utf8")
    const local = await readFile(path.join(tuiRoot, "context/local.tsx"), "utf8")
    const connectedHelper = await readFile(path.join(tuiRoot, "component/use-connected.tsx"), "utf8")
    const workspaceLabel = await readFile(path.join(tuiRoot, "component/workspace-label.tsx"), "utf8")
    const dialogModel = await readFile(path.join(tuiRoot, "component/dialog-model.tsx"), "utf8")
    const homeTips = await readFile(path.join(tuiRoot, "feature-plugins/home/tips.tsx"), "utf8")
    const homeFooter = await readFile(path.join(tuiRoot, "feature-plugins/home/footer.tsx"), "utf8")
    const sidebarFooter = await readFile(path.join(tuiRoot, "feature-plugins/sidebar/footer.tsx"), "utf8")
    const whichKey = await readFile(path.join(tuiRoot, "feature-plugins/system/which-key.tsx"), "utf8")
    const pluginManager = await readFile(path.join(tuiRoot, "feature-plugins/system/plugins.tsx"), "utf8")
    const notifications = await readFile(path.join(tuiRoot, "feature-plugins/system/notifications.ts"), "utf8")
    const agentTeam = await readFile(path.join(tuiRoot, "feature-plugins/sidebar/agent-team.tsx"), "utf8")
    const agentTeamActions = await readFile(path.join(tuiRoot, "feature-plugins/sidebar/agent-team-actions.ts"), "utf8")
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
    const sync = await readFile(path.join(tuiRoot, "context/sync.tsx"), "utf8")
    const pluginHostApi = await readFile(path.join(tuiRoot, "plugin/api.tsx"), "utf8")
    const pluginApi = await readFile(path.join(projectRoot, "../plugin/src/tui.ts"), "utf8")
    const serverRoutes = await readFile(path.join(projectRoot, "src/server/routes/app.ts"), "utf8")
    const sdk = await readFile(path.join(projectRoot, "../sdk/js/src/gen/sdk.gen.ts"), "utf8")

    expect(app).toContain('from "./plugin/api"')
    expect(app).toContain('from "./plugin/runtime"')
    expect(app).toContain('from "@tui/component/use-connected"')
    expect(app).toContain("TuiPluginRuntime.init")
    expect(app).toContain('<TuiPluginRuntime.Slot name="app_bottom" />')
    expect(app).toContain('<TuiPluginRuntime.Slot name="app" />')
    expect(route).toContain('type: "plugin"')
    expect(runtime).toContain("createScopedKeymap")
    expect(runtime).toContain("scope.track(host.register")
    expect(slots).toContain("createSolidSlotRegistry")
    expect(slots).toContain("createSlot")
    expect(home).toContain('name="home_logo"')
    expect(home).toContain("BgPulse")
    expect(home).toContain('name="home_prompt"')
    expect(home).toContain('name="home_prompt_right"')
    expect(home).toContain("placeholders={placeholder}")
    expect(home).toContain("promptMaxWidth")
    expect(home).toContain('name="home_bottom"')
    expect(home).toContain('name="home_footer"')
    expect(home).not.toContain("Tips />")
    expect(home).not.toContain("useDirectory")
    expect(home).not.toContain("sync.data.mcp")
    expect(existsSync(path.join(tuiRoot, "component/bg-pulse.tsx"))).toBe(true)
    expect(existsSync(path.join(tuiRoot, "component/bg-pulse-render.ts"))).toBe(true)
    expect(bgPulse).toContain("FrameBufferRenderable")
    expect(bgPulse).toContain("extend({ logo_pulse_art: LogoPulseRenderable })")
    expect(bgPulse).toContain("renderer.targetFps = 30")
    expect(bgPulseRender).toContain('from "@/cli/logo"')
    expect(bgPulseRender).toContain("export class LogoPulsePainter")
    expect(bgPulseRender).toContain("frameBuffer.buffers.fg")
    expect(bgPulseRender).not.toContain("GoUpsell")
    expect(bgPulseRender).not.toContain("{ go }")
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
      "SidebarAgentTeam",
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
    expect(agentTeamActions).toContain('panelCapabilities(surface)')
    expect(agentTeamActions).toContain('const surface = "right-sidebar"')
    expect(agentTeam).toContain("props.api.state.project.tasks()")
    expect(agentTeam).toContain("active_sessions")
    expect(agentTeam).toContain("pending_interactions")
    expect(agentTeamActions).toContain("pending_interaction_items")
    expect(agentTeam).toContain('sidebar_content()')
    expect(agentTeam).toContain('name: "agent_team.tools"')
    expect(agentTeam).toContain('name: "agent_team.tasks"')
    expect(agentTeamActions).toContain("api.client.coding.sessions.list")
    expect(agentTeamActions).toContain("api.client.coding.session.create")
    expect(agentTeamActions).toContain("api.client.coding.session.selection.update")
    expect(agentTeamActions).toContain("api.client.task.message")
    expect(agentTeamActions).toContain("api.client.task.retry")
    expect(agentTeamActions).toContain("api.client.task.replan")
    expect(agentTeamActions).toContain("api.client.task.cancel")
    expect(agentTeamActions).toContain("RIGHT_SIDEBAR_CODING_ASSISTANT_SOURCE")
    expect(agentTeamActions).toContain('capabilities("mutation").flatMap')
    expect(agentTeam).toContain('onMouseUp={() => showTask(props.api, item)}')
    expect(sync).toContain("project_board")
    expect(sync).toContain("sdk.client.task.list({ limit: 8 })")
    expect(pluginHostApi).toContain("project: {")
    expect(pluginHostApi).toContain("sync.data.project_board?.tasks ?? []")
    expect(existsSync(path.join(tuiRoot, "component/use-connected.tsx"))).toBe(true)
    expect(connectedHelper).toContain("Copied from OpenCode's provider connectivity helper")
    expect(connectedHelper).toContain("export function isProviderConnected")
    expect(connectedHelper).toContain("export function useConnected")
    expect(connectedHelper).toContain('item.id !== "opencorvus"')
    expect(connectedHelper).toContain("model.cost?.input !== 0")
    expect(dialogModel).toContain('from "./use-connected"')
    expect(dialogModel).not.toContain("export function useConnected")
    expect(homeTips).toContain('home_bottom()')
    expect(homeTips).toContain('name: "tips.toggle"')
    expect(homeTips).toContain("isProviderConnected")
    expect(homeTips).not.toContain('id !== "opencorvus"')
    expect(sidebarFooter).toContain("isProviderConnected")
    expect(sidebarFooter).not.toContain('id !== "opencorvus"')
    expect(existsSync(path.join(tuiRoot, "component/workspace-label.tsx"))).toBe(true)
    expect(workspaceLabel).toContain("export type WorkspaceStatus")
    expect(workspaceLabel).toContain('props.status === "connected"')
    expect(workspaceLabel).toContain('props.status === "error"')
    expect(sidebarFooter).toContain("WorkspaceLabel")
    expect(sidebarFooter).toContain("projectStatus")
    expect(sidebarFooter).toContain("git:${props.api.state.vcs.branch}")
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
    expect(existsSync(path.join(tuiRoot, "routes/session/footer.tsx"))).toBe(true)
    expect(sessionRoute).toContain('fallback={<Footer />}')
    expect(existsSync(path.join(tuiRoot, "util/collapse-tool-output.ts"))).toBe(true)
    expect(collapseToolOutput).toContain("Copied from OpenCode")
    expect(collapseToolOutput).toContain("export function collapseToolOutput")
    expect(collapseToolOutput).toContain("Array.from(output).length")
    expect(sessionRoute).toContain('from "../../util/collapse-tool-output"')
    expect(sessionRoute).toContain("collapseToolOutput(output(), maxLines, maxChars())")
    expect(existsSync(path.join(tuiRoot, "context/path-format.tsx"))).toBe(true)
    expect(pathFormat).toContain("Copied from OpenCode")
    expect(pathFormat).toContain("export function PathFormatterProvider")
    expect(pathFormat).toContain("export function usePathFormatter")
    expect(sessionRoute).toContain('from "../../context/path-format"')
    expect(sessionRoute).toContain("<PathFormatterProvider path={session()?.directory}>")
    expect(sessionRoute).toContain("pathFormatter.format(props.input.filePath)")
    expect(sessionRoute).not.toContain("function normalizePath")
    expect(existsSync(path.join(tuiRoot, "context/thinking.ts"))).toBe(true)
    expect(thinking).toContain("Copied from OpenCode")
    expect(thinking).toContain("export function reasoningSummary")
    expect(thinking).toContain("export function useThinkingMode")
    expect(thinking).toContain('kv.signal<ThinkingMode>("thinking_mode", "hide")')
    expect(sessionRoute).toContain('from "../../context/thinking"')
    expect(sessionRoute).toContain("const thinking = useThinkingMode()")
    expect(sessionRoute).toContain("thinkingMode")
    expect(sessionRoute).toContain("ReasoningHeader")
    expect(sessionRoute).toContain("reasoningSummary(content())")
    expect(sessionRoute).not.toContain('kv.signal("thinking_visibility"')
    expect(dialogMessage).toContain("useThinkingMode")
    expect(dialogMessage).not.toContain('kv.signal("thinking_visibility"')
    expect(sessionFooter).toContain("export function Footer")
    expect(sessionFooter).toContain("useDirectory")
    expect(sessionFooter).toContain("useConnected")
    expect(sessionFooter).toContain("sync.data.mcp")
    expect(sessionFooter).toContain("sync.data.lsp")
    expect(sessionFooter).toContain("sync.data.permission")
    expect(existsSync(path.join(tuiRoot, "routes/session/subagent-footer.tsx"))).toBe(true)
    expect(sessionRoute).toContain("<SubagentFooter />")
    expect(sessionRoute).toContain("session()?.parentID")
    expect(sessionHeader).not.toContain('dispatchCommand("session.parent")')
    expect(sessionHeader).not.toContain('dispatchCommand("session.child.previous")')
    expect(sessionHeader).not.toContain('dispatchCommand("session.child.next")')
    expect(subagentFooter).toContain("SubagentFooter")
    expect(subagentFooter).toContain("useOpencorvusKeymap")
    expect(subagentFooter).toContain('dispatchCommand("session.parent")')
    expect(subagentFooter).toContain('dispatchCommand("session.child.previous")')
    expect(subagentFooter).toContain('dispatchCommand("session.child.next")')
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
    expect(pluginApi).toContain("TaskListResponse")
    expect(pluginApi).toContain("project: {")
    expect(pluginApi).toContain('Omit<FilePart, "id" | "messageID" | "sessionID">')
    expect(serverRoutes).toContain('operationId: "vcs.diff"')
    expect(serverRoutes).toContain('"/vcs/diff"')
    expect(sdk).toContain("public diff<ThrowOnError")
    expect(sdk).toContain('url: "/vcs/diff"')
  })

  test("agent team task actions dispatch through canonical SDK payloads", async () => {
    const selectDialogs: Array<{
      title: string
      options: Array<{ title: string; value: string; description?: string }>
      onSelect?: (option: { title: string; value: string; description?: string }) => void
    }> = []
    const prompts: Array<{ onConfirm?: (value: string) => void }> = []
    const confirms: Array<{ onConfirm?: () => void }> = []
    const calls: Array<{ name: string; parameters: Record<string, unknown> }> = []
    const task = {
      task: {
        id: "task_1",
        projectID: "project_1",
        directory: "D:/workspace",
        sessionID: null,
        title: "Implement task actions",
        request: "Implement task actions",
        source: "test",
        status: "active",
        priority: "normal",
        time: { created: 1, updated: 1 },
      },
      active_sessions: [],
      pending_interactions: 1,
      pending_interaction_items: [
        {
          id: "int_1",
          taskID: "task_1",
          runID: "run_1",
          externalID: "perm_1",
          type: "permission",
          status: "pending",
          title: "Approve command",
          body: "Allow command?",
          time: { created: 1, updated: 1 },
        },
      ],
      updated_at: 1,
    }
    const api = {
      state: {
        path: { directory: "D:/workspace", state: "", config: "", worktree: "" },
        project: {
          tasks: () => [task],
          summary: () => ({ open_tasks: 1, running_tasks: 1 }),
        },
      },
      theme: { current: { text: "white", textMuted: "gray" } },
      route: {
        navigate() {
          throw new Error("select_task must persist selection instead of navigating")
        },
      },
      ui: {
        dialog: {
          replace(render: () => unknown) {
            render()
          },
        },
        DialogSelect(props: (typeof selectDialogs)[number]) {
          selectDialogs.push(props)
          return undefined
        },
        DialogPrompt(props: { onConfirm?: (value: string) => void }) {
          prompts.push(props)
          return undefined
        },
        DialogConfirm(props: { onConfirm?: () => void }) {
          confirms.push(props)
          return undefined
        },
        toast() {},
      },
      client: {
        coding: {
          sessions: {
            async list(parameters: Record<string, unknown>) {
              calls.push({ name: "coding.sessions.list", parameters })
              return { data: { sessions: [{ id: "ses_right_sidebar" }] } }
            },
          },
          session: {
            async create(parameters: Record<string, unknown>) {
              calls.push({ name: "coding.session.create", parameters })
              return { data: { session: { id: "ses_created" } } }
            },
            selection: {
              async update(parameters: Record<string, unknown>) {
                calls.push({ name: "coding.session.selection.update", parameters })
                return { data: { session: { id: parameters.sessionID } } }
              },
            },
          },
        },
        task: {
          async message(parameters: Record<string, unknown>) {
            calls.push({ name: "task.message", parameters })
            return { data: { message: "sent" } }
          },
          async retry(parameters: Record<string, unknown>) {
            calls.push({ name: "task.retry", parameters })
            return { data: true }
          },
          async replan(parameters: Record<string, unknown>) {
            calls.push({ name: "task.replan", parameters })
            return { data: true }
          },
          async cancel(parameters: Record<string, unknown>) {
            calls.push({ name: "task.cancel", parameters })
            return { data: true }
          },
        },
        interaction: {
          async reply(parameters: Record<string, unknown>) {
            calls.push({ name: "interaction.reply", parameters })
            return { data: { id: parameters.interactionID } }
          },
          async reject(parameters: Record<string, unknown>) {
            calls.push({ name: "interaction.reject", parameters })
            return { data: { id: parameters.interactionID } }
          },
        },
      },
    } as unknown as TuiPluginApi
    const settle = async () => {
      await Promise.resolve()
      await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    const choose = async (value: string) => {
      const dialog = selectDialogs.at(-1)!
      const option = dialog.options.find((item) => item.value === value || item.value.startsWith(`${value}:`))!
      dialog.onSelect?.(option)
      await settle()
    }

    showTasks(api)
    await choose("task_1")

    await choose("select_task")
    expect(calls).toContainEqual({
      name: "coding.sessions.list",
      parameters: { directory: "D:/workspace", limit: 1 },
    })
    expect(calls).toContainEqual({
      name: "coding.session.selection.update",
      parameters: { sessionID: "ses_right_sidebar", directory: "D:/workspace", taskID: "task_1" },
    })

    await choose("reply_interaction")
    expect(calls).toContainEqual({
      name: "interaction.reply",
      parameters: { interactionID: "int_1", directory: "D:/workspace", reply: "once", autoReply: false },
    })

    await choose("reject_interaction")
    prompts.at(-1)!.onConfirm?.("deny")
    await settle()
    expect(calls).toContainEqual({
      name: "interaction.reject",
      parameters: { interactionID: "int_1", directory: "D:/workspace", message: "deny", autoReply: false },
    })

    await choose("send_task_message")
    prompts.at(-1)!.onConfirm?.(" follow up ")
    await settle()
    expect(calls).toContainEqual({
      name: "task.message",
      parameters: {
        taskID: "task_1",
        directory: "D:/workspace",
        text: "follow up",
        source: RIGHT_SIDEBAR_CODING_ASSISTANT_SOURCE,
      },
    })

    await choose("retry_task")
    await choose("replan_task")
    await choose("cancel_task")
    confirms.at(-1)!.onConfirm?.()
    await settle()
    expect(calls).toContainEqual({ name: "task.retry", parameters: { taskID: "task_1", directory: "D:/workspace" } })
    expect(calls).toContainEqual({ name: "task.replan", parameters: { taskID: "task_1", directory: "D:/workspace" } })
    expect(calls).toContainEqual({ name: "task.cancel", parameters: { taskID: "task_1", directory: "D:/workspace" } })
  })
})
