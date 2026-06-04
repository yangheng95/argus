// OpenCode-compatible internal TUI plugin registry. Feature plugins are copied into this list in later rounds.
import type { TuiPlugin, TuiPluginModule } from "@opencorvus-ai/plugin/tui"
import HomeFooter from "../feature-plugins/home/footer"
import HomeTips from "../feature-plugins/home/tips"
import SessionSwitcher from "../feature-plugins/session"
import SidebarContext from "../feature-plugins/sidebar/context"
import SidebarMcp from "../feature-plugins/sidebar/mcp"
import SidebarLsp from "../feature-plugins/sidebar/lsp"
import SidebarTodo from "../feature-plugins/sidebar/todo"
import SidebarFiles from "../feature-plugins/sidebar/files"
import SidebarFooter from "../feature-plugins/sidebar/footer"
import SidebarAgentTeam from "../feature-plugins/sidebar/agent-team"
import DiffViewer from "../feature-plugins/system/diff-viewer"
import PluginManager from "../feature-plugins/system/plugins"
import Notifications from "../feature-plugins/system/notifications"
import WhichKey from "../feature-plugins/system/which-key"

export type InternalTuiPlugin = Omit<TuiPluginModule, "id"> & {
  id: string
  tui: TuiPlugin
  enabled?: boolean
}

export function internalTuiPlugins(): InternalTuiPlugin[] {
  return [
    HomeFooter,
    HomeTips,
    SessionSwitcher,
    SidebarContext,
    SidebarMcp,
    SidebarLsp,
    SidebarTodo,
    SidebarFiles,
    SidebarAgentTeam,
    SidebarFooter,
    DiffViewer,
    Notifications,
    PluginManager,
    WhichKey,
  ]
}
