import { Auth } from "../auth"
import { Instance } from "../project/instance"
import { Provider } from "./provider"

export const DEFAULT_OPENAI_CODEX_MODEL = "openai/gpt-5.3-codex"
export const OPENAI_CODEX_AUTH_COMMAND = "bun run packages/opencorvus/src/index.ts auth login"

export function normalizeOpenAICodexModel(model = DEFAULT_OPENAI_CODEX_MODEL) {
  return model.includes("/") ? model : `openai/${model}`
}

export function openAICodexAuthHelp() {
  return `Run \`${OPENAI_CODEX_AUTH_COMMAND}\` and choose "ChatGPT Pro/Plus (browser)".`
}

export async function hasOpenAICodexAuth() {
  return (await Auth.get("openai"))?.type === "oauth"
}

export async function getOpenAICodexLanguage(input: { directory: string; model?: string }) {
  return Instance.provide({
    directory: input.directory,
    async fn() {
      if (!(await hasOpenAICodexAuth())) {
        throw new Error(`OpenAI OAuth credentials not found. ${openAICodexAuthHelp()}`)
      }
      const parsed = Provider.parseModel(normalizeOpenAICodexModel(input.model))
      const resolved = await Provider.getModel(parsed.providerID, parsed.modelID)
      return Provider.getLanguage(resolved)
    },
  })
}
