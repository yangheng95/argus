import { apiJson } from "./api"

export interface TuiRuntimeStatus {
  running: boolean
  mode: "none" | "spawned" | "connected"
  url: string | null
  sessionID: string | null
}

export async function loadTuiRuntimeStatus(): Promise<TuiRuntimeStatus> {
  return await apiJson("tui/runtime/status")
}
