// OpenCorvus project/agent-team sidebar plugin built on OpenCode's slot plugin pattern.
import type { TuiPlugin, TuiPluginApi } from "@opencorvus-ai/plugin/tui"
import type { InternalTuiPlugin } from "../../plugin/internal"
import { For, Show, createMemo } from "solid-js"
import { capabilities, show, showTask, showTasks, taskTitle, title } from "./agent-team-actions"

const id = "internal:sidebar-agent-team"

function View(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const queries = createMemo(() => capabilities("query"))
  const mutations = createMemo(() => capabilities("mutation"))
  const summary = createMemo(() => props.api.state.project.summary())
  const tasks = createMemo(() => props.api.state.project.tasks().slice(0, 5))
  const activeAgents = createMemo(() => tasks().reduce((sum, item) => sum + item.active_sessions.length, 0))

  return (
    <box>
      <text fg={theme().text}>
        <b>Agent Team</b>
      </text>
      <text fg={theme().textMuted}>
        {summary()?.open_tasks ?? 0} open · {summary()?.running_tasks ?? 0} running · {activeAgents()} agents
      </text>
      <For each={tasks()}>
        {(item) => (
          <box onMouseUp={() => showTask(props.api, item)}>
            <text fg={theme().textMuted} wrapMode="none">
              {item.task.status} · {taskTitle(item.task.title)}
            </text>
            <Show when={item.active_sessions.length > 0 || item.pending_interactions > 0}>
              <text fg={theme().textMuted} wrapMode="none">
                {item.active_sessions.length} active agents
                <Show when={item.pending_interactions > 0}> · {item.pending_interactions} interactions</Show>
              </text>
            </Show>
          </box>
        )}
      </For>
      <Show when={tasks().length === 0}>
        <text fg={theme().textMuted}>No project tasks</text>
      </Show>
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
      {
        name: "agent_team.tasks",
        title: "Agent team task actions",
        category: "Agent Team",
        namespace: "palette",
        run() {
          showTasks(api)
        },
      },
    ],
    bindings: api.tuiConfig.keybinds.gather("agent-team.palette", ["agent_team.tools", "agent_team.tasks"]),
  })
}

const plugin: InternalTuiPlugin = {
  id,
  tui,
}

export default plugin
