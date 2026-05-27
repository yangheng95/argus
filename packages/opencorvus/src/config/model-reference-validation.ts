import { Provider } from "@/provider/provider"

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function collectModelReferences(input: unknown, root: string): Array<{ path: string; model: string }> {
  if (!isRecord(input)) return []
  const refs: Array<{ path: string; model: string }> = []
  if (typeof input.model === "string" && input.model.trim()) {
    refs.push({ path: `${root}.model`, model: input.model })
  }
  if (isRecord(input.agent)) {
    for (const [agentID, agent] of Object.entries(input.agent)) {
      if (!isRecord(agent)) continue
      if (typeof agent.model === "string" && agent.model.trim()) {
        refs.push({ path: `${root}.agent.${agentID}.model`, model: agent.model })
      }
    }
  }
  return refs
}

export async function validateConfigModelReferences(input: unknown, root = "config") {
  for (const ref of collectModelReferences(input, root)) {
    const parsed = Provider.parseModel(ref.model)
    await Provider.getModel(parsed.providerID, parsed.modelID).catch((error) => {
      if (error instanceof Provider.ModelNotFoundError) {
        error.data.suggestions = error.data.suggestions ?? []
      }
      throw error
    })
  }
}
