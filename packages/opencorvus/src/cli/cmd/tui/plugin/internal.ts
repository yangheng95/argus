// OpenCode-compatible internal TUI plugin registry. Feature plugins are copied into this list in later rounds.
import type { TuiPlugin, TuiPluginModule } from "@opencorvus-ai/plugin/tui"

export type InternalTuiPlugin = Omit<TuiPluginModule, "id"> & {
  id: string
  tui: TuiPlugin
  enabled?: boolean
}

export function internalTuiPlugins(): InternalTuiPlugin[] {
  return []
}
