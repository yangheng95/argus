// Copied from OpenCode's sidebar footer plugin and adapted to OpenCorvus state and branding.
import type { TuiPlugin, TuiPluginApi } from "@opencorvus-ai/plugin/tui"
import type { InternalTuiPlugin } from "../../plugin/internal"
import { createMemo, Show } from "solid-js"
import { Global } from "@/global"
import { isProviderConnected } from "../../component/use-connected"
import { WorkspaceLabel, type WorkspaceStatus } from "../../component/workspace-label"

const id = "internal:sidebar-footer"

function View(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const has = createMemo(() => props.api.state.provider.some(isProviderConnected))
  const done = createMemo(() => props.api.kv.get("dismissed_getting_started", false))
  const show = createMemo(() => !has() && !done())
  const path = createMemo(() => {
    const dir = props.api.state.path.directory || process.cwd()
    const out = dir.replace(Global.Path.home, "~")
    const list = out.split("/")
    return {
      parent: list.slice(0, -1).join("/"),
      name: list.at(-1) ?? "",
      type: props.api.state.vcs?.branch ? `git:${props.api.state.vcs.branch}` : "project",
    }
  })
  const projectStatus = createMemo<WorkspaceStatus>(() => {
    if (!props.api.state.path.directory) return "disconnected"
    return props.api.state.ready ? "connected" : "connecting"
  })

  return (
    <box gap={1}>
      <Show when={show()}>
        <box
          backgroundColor={theme().backgroundElement}
          paddingTop={1}
          paddingBottom={1}
          paddingLeft={2}
          paddingRight={2}
          flexDirection="row"
          gap={1}
        >
          <text flexShrink={0} fg={theme().text}>
            ⬖
          </text>
          <box flexGrow={1} gap={1}>
            <box flexDirection="row" justifyContent="space-between">
              <text fg={theme().text}>
                <b>Getting started</b>
              </text>
              <text fg={theme().textMuted} onMouseDown={() => props.api.kv.set("dismissed_getting_started", true)}>
                ✕
              </text>
            </box>
            <text fg={theme().textMuted}>OpenCorvus includes free models so you can start immediately.</text>
            <text fg={theme().textMuted}>
              Connect from 75+ providers to use other models, including Claude, GPT, Gemini etc
            </text>
            <box flexDirection="row" gap={1} justifyContent="space-between">
              <text fg={theme().text}>Connect provider</text>
              <text fg={theme().textMuted}>/connect</text>
            </box>
          </box>
        </box>
      </Show>
      <text>
        <span style={{ fg: theme().textMuted }}>{path().parent}/</span>
        <WorkspaceLabel type={path().type} name={path().name} status={projectStatus()} icon />
      </text>
      <text fg={theme().textMuted}>
        <span style={{ fg: theme().success }}>•</span> <b>Open</b>
        <span style={{ fg: theme().text }}>
          <b>Corvus</b>
        </span>{" "}
        <span>{props.api.app.version}</span>
      </text>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 100,
    slots: {
      sidebar_footer() {
        return <View api={api} />
      },
    },
  })
}

const plugin: InternalTuiPlugin = {
  id,
  tui,
}

export default plugin
