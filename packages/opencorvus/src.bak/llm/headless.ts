import type { LanguageModelV2 } from "@ai-sdk/provider"
import type { ModelMessage, ToolSet } from "ai"
import { Config } from "@/config/config"
import { completeText, type TextHooks } from "@/llm/api"
import { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import { Instance } from "@/project/instance"
import { Message } from "@/session/message"
import { mergeDeep, pipe } from "remeda"

type ModelRef = {
  providerID: string
  modelID: string
}

function taskModel(metadata?: Record<string, unknown>) {
  const item = metadata?.task_model
  if (!item || typeof item !== "object" || Array.isArray(item)) return
  const ref = item as Record<string, unknown>
  if (typeof ref.providerID !== "string" || typeof ref.modelID !== "string") return
  return {
    providerID: ref.providerID,
    modelID: ref.modelID,
  }
}

async function sessionModel(sessionID: string) {
  for await (const item of Message.stream(sessionID)) {
    if (item.info.role === "user" && item.info.model) return item.info.model
  }
}

function explicitEnvModel() {
  for (const key of ["OPENCORVUS_BENCHMARK_MODEL", "OPENCORVUS_E2E_MODEL"]) {
    const value = process.env[key]?.trim()
    if (value && value.includes("/")) return Provider.parseModel(value)
  }
}

export async function configuredHeadlessModelRef() {
  const env = explicitEnvModel()
  if (env) return env
  const cfg = await Config.get()
  if (cfg.model) return Provider.parseModel(cfg.model)
}

export async function resolveHeadlessModelRef(input: {
  model?: ModelRef
  metadata?: Record<string, unknown>
  sessionID?: string
}): Promise<ModelRef> {
  if (input.model) return input.model
  const stored = taskModel(input.metadata)
  if (stored) return stored
  if (input.sessionID) {
    const resolved = await sessionModel(input.sessionID)
    if (resolved) return resolved
  }
  const configured = await configuredHeadlessModelRef()
  if (configured) return configured
  return Provider.defaultModel()
}

export async function resolveHeadlessLanguageModel(input: {
  label: string
  model?: ModelRef
  metadata?: Record<string, unknown>
  sessionID?: string
}) {
  const resolved = await resolveHeadlessModelRef(input)
  const model = await Provider.getModel(resolved.providerID, resolved.modelID)
  const language = await Provider.getLanguage(model)
  return {
    model,
    language,
    isReasoning: model.capabilities.reasoning === true,
    sessionID: input.sessionID ?? `headless:${input.label}:${Instance.project.id}`,
  }
}

export async function completeHeadlessText<TOOLS extends ToolSet>(input: {
  label: string
  model: Provider.Model
  language: LanguageModelV2
  prompt: string
  system: string | string[]
  sessionID?: string
  tools: TOOLS
  stopWhen?: Parameters<typeof completeText<TOOLS>>[0]["stopWhen"]
  maxOutputTokens?: number
  timeoutMs?: number | false
  abortSignal?: AbortSignal
} & TextHooks<TOOLS>) {
  const {
    abortSignal,
    label,
    language,
    maxOutputTokens,
    model,
    prompt,
    sessionID: rawSessionID,
    stopWhen,
    system,
    timeoutMs,
    tools,
    ...hooks
  } = input
  const provider = await Provider.getProvider(model.providerID)
  const cfg = await Config.get()
  const sessionID = rawSessionID ?? `headless:${label}:${Instance.project.id}`
  const options = pipe(
    ProviderTransform.options({
      model,
      sessionID,
      providerOptions: provider.options,
    }),
    mergeDeep(model.options),
  )
  const messages = ProviderTransform.message(
    [
      ...[system].flat().map(
        (item): ModelMessage => ({
          role: "system",
          content: item,
        }),
      ),
      {
        role: "user",
        content: prompt,
      },
    ],
    model,
    options,
  )
  const providerOptions = ProviderTransform.providerOptions(model, options)

  // DashScope streaming: enable_thinking conflicts with structured tool_calls.
  // Same fix as session/llm.ts — strip enable_thinking when real tools are present.
  if (
    model.providerID.startsWith("alibaba") &&
    model.capabilities.reasoning &&
    tools &&
    Object.keys(tools).length > 0
  ) {
    const key = Object.keys(providerOptions).find((k) => k.startsWith("alibaba"))
    if (key && providerOptions[key]?.enable_thinking) {
      providerOptions[key] = { ...providerOptions[key] }
      delete providerOptions[key].enable_thinking
    }
  }

  return completeText<TOOLS>({
    ...hooks,
    abortSignal,
    maxOutputTokens: maxOutputTokens ?? ProviderTransform.maxOutputTokens(model),
    model: language,
    messages,
    providerOptions,
    stopWhen,
    temperature: model.capabilities.temperature ? ProviderTransform.temperature(model) : undefined,
    timeoutMs,
    tools,
    topK: ProviderTransform.topK(model),
    topP: ProviderTransform.topP(model),
    experimental_telemetry: {
      isEnabled: cfg.experimental?.openTelemetry,
      metadata: {
        userId: cfg.username ?? "unknown",
        sessionId: sessionID,
      },
    },
  } as Parameters<typeof completeText<TOOLS>>[0])
}

