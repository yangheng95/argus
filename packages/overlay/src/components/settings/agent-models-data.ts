import { apiJsonWithTimeout } from "../../services/api"
import { settingsStore } from "../../store/settings"

export interface AgentInfo {
  name: string
  description?: string
  mode: "subagent" | "primary" | "all"
  hidden?: boolean
  native?: boolean
  model?: { providerID: string; modelID: string }
}

export interface ProviderModel {
  id: string
  name?: string
}

export interface ProviderInfo {
  id: string
  name: string
  models: Record<string, ProviderModel>
}

export interface ProvidersPayload {
  providers: ProviderInfo[]
  default: Record<string, string>
}

export const AGENT_MODELS_LOAD_TIMEOUT_MILLISECONDS = 15_000

export function requireAgentModelsDirectory(): string {
  const directory = settingsStore.directory.trim()
  if (!directory) {
    throw new Error("Working directory required before loading agent models")
  }
  return directory
}

export async function loadAgentModelsData(
  timeoutMilliseconds = AGENT_MODELS_LOAD_TIMEOUT_MILLISECONDS,
): Promise<{ agents: AgentInfo[]; providers: ProvidersPayload }> {
  requireAgentModelsDirectory()
  const [agents, providers] = await Promise.all([
    apiJsonWithTimeout<AgentInfo[]>("agent", timeoutMilliseconds),
    apiJsonWithTimeout<ProvidersPayload>("config/providers", timeoutMilliseconds),
  ])
  return {
    agents: agents ?? [],
    providers: providers ?? { providers: [], default: {} },
  }
}
