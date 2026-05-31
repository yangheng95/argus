import { createAgentContextTools } from "@/agent/context-tools"

type RetrievalToolOptions = {
  websearch?: boolean
}

export function createReadonlyRetrievalTools(taskWorkDir?: string, options: RetrievalToolOptions = {}) {
  const tools = createAgentContextTools(taskWorkDir)
  if (options.websearch === false) {
    const { websearch: _websearch, ...withoutWebsearch } = tools
    return withoutWebsearch
  }
  return tools
}
