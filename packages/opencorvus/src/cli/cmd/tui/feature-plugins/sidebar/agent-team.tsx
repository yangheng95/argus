// OpenCorvus project/agent-team sidebar plugin built on OpenCode's slot plugin pattern.
import type { TuiPlugin, TuiPluginApi } from "@opencorvus-ai/plugin/tui"
import type { InternalTuiPlugin } from "../../plugin/internal"
import { panelCapabilities } from "@/panel/capability"
import { For, Show, createMemo } from "solid-js"

const id = "internal:sidebar-agent-team"
const surface = "right-sidebar"

function title(action: string) {
  return action.replaceAll("_", " ")
}

function capabilities(kind?: "query" | "mutation") {
  const actions = panelCapabilities(surface).actions
  return kind ? actions.filter((item) => item.kind === kind) : actions
}

function View(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const queries = createMemo(() => capabilities("query"))
  const mutations = createMemo(() => capabilities("mutation"))

  return (
    <box>
      <text fg={theme().text}>
        <b>Agent Team</b>
      </text>
      <text fg={theme().textMuted}>
        {queries().length} query tools · {mutations().length} action tools
      </text>
      <For each={mutations().slice(0, 6)}>
        {(item) => (
          <text fg={theme().textMuted} wrapMode="none">
            • {title(item.action)}
          </text>
        )}
      </For>
      <Show when={mutations().length > 6}>
        <text fg={theme().textMuted}>+{mutations().length - 6} more</text>
      </Show>
    </box>
  )
}

function show(api: TuiPluginApi) {
  const options = capabilities().map((item) => ({
    title: item.action,
    value: item.action,
    description: item.description,
    category: item.kind === "query" ? "Project Query" : "Agent Team Action",
  }))
  api.ui.dialog.replace(() => (
    <api.ui.DialogSelect
      title="Agent Team Tools"
      options={options}
      onSelect={(item) => {
        api.ui.toast({
          variant: "info",
          message: `${item.value} is available through the project-bound panel tool surface.`,
        })
      }}
    />
  ))
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 650,
    slots: {
      sidebar_content() {
        return <View api={api} />
      },
    },
  })
  api.keymap.registerLayer({
    commands: [
      {
        name: "agent_team.tools",
        title: "Agent team tools",
        category: "Agent Team",
        namespace: "palette",
        run() {
          show(api)
        },
      },
    ],
    bindings: api.tuiConfig.keybinds.gather("agent-team.palette", ["agent_team.tools"]),
  })
}

const plugin: InternalTuiPlugin = {
  id,
  tui,
}

export default plugin
