import { apiJsonWithTimeout } from "../../services/api";

export interface AgentInfo {
  name: string;
  description?: string;
  mode: "subagent" | "primary" | "all";
  hidden?: boolean;
  native?: boolean;
  model?: { providerID: string; modelID: string };
}

export interface ProviderModel {
  id: string;
  name?: string;
}

export interface ProviderInfo {
  id: string;
  name: string;
  models: Record<string, ProviderModel>;
}

export interface ProvidersPayload {
  providers: ProviderInfo[];
  default: Record<string, string>;
}

export const AGENT_MODELS_LOAD_TIMEOUT_MILLISECONDS = 15_000;
export const HEXIN_REFRESH_TIMEOUT_MILLISECONDS = 20_000;

export async function loadAgentModelsData(
  timeoutMilliseconds = AGENT_MODELS_LOAD_TIMEOUT_MILLISECONDS,
): Promise<{ agents: AgentInfo[]; providers: ProvidersPayload }> {
  const [agents, providers] = await Promise.all([
    apiJsonWithTimeout<AgentInfo[]>("agent", timeoutMilliseconds),
    apiJsonWithTimeout<ProvidersPayload>("config/providers", timeoutMilliseconds),
  ]);
  return {
    agents: agents ?? [],
    providers: providers ?? { providers: [], default: {} },
  };
}
