// OpenCode-compatible internal TUI plugin registry. Feature plugins are copied into this list in later rounds.
import type { TuiPlugin, TuiPluginModule } from "@opencorvus-ai/plugin/tui"
import SidebarContext from "../feature-plugins/sidebar/context"
import SidebarMcp from "../feature-plugins/sidebar/mcp"
import SidebarLsp from "../feature-plugins/sidebar/lsp"
import SidebarTodo from "../feature-plugins/sidebar/todo"
import SidebarFiles from "../feature-plugins/sidebar/files"
import SidebarFooter from "../feature-plugins/sidebar/footer"

export type InternalTuiPlugin = Omit<TuiPluginModule, "id"> & {
  id: string
  tui: TuiPlugin
  enabled?: boolean
}

export function internalTuiPlugins(): InternalTuiPlugin[] {
  return [SidebarContext, SidebarMcp, SidebarLsp, SidebarTodo, SidebarFiles, SidebarFooter]
}
