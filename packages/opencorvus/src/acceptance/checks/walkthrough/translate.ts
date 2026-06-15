import { tool, type LanguageModel } from "ai"
import z from "zod"
import { resolveAgentModel } from "@/agent/model"
import { EffectiveConfig } from "@/config/effective"
import { streamText } from "@/llm/api"
import { Provider } from "@/provider/provider"
import { ProviderLLM } from "@/provider/llm"
import { ProviderSchema } from "@/provider/schema"
import type { AcceptanceSpec } from "@/acceptance/types"
import { WalkthroughStepSchema, WalkthroughStepsSchema, type WalkthroughStep } from "./dsl"

const TranslateOutputSchema = z.object({ steps: WalkthroughStepsSchema })

type TranslateScenarioInput = {
  spec: AcceptanceSpec
  taskID?: string
  sessionID?: string
}

export type TranslateScenarioDependencies = {
  resolveModel: (input: TranslateScenarioInput) => Promise<Provider.Model>
  getLanguage: (model: Provider.Model, input: TranslateScenarioInput) => Promise<LanguageModel>
  stream: typeof streamText
}

const defaultDependencies: TranslateScenarioDependencies = {
  resolveModel: (input) => resolveAgentModel("requirements", { taskID: input.taskID, sessionID: input.sessionID }),
  getLanguage: async (model, input) => {
    const config = await EffectiveConfig.effective({ taskID: input.taskID, sessionID: input.sessionID })
    return Provider.getLanguage(model, { config })
  },
  stream: streamText,
}

export async function translateScenarioToSteps(input: TranslateScenarioInput): Promise<WalkthroughStep[]> {
  return translateScenarioToStepsWithDependencies(input, defaultDependencies)
}

export async function translateScenarioToStepsWithDependencies(
  input: TranslateScenarioInput,
  dependencies: TranslateScenarioDependencies,
): Promise<WalkthroughStep[]> {
  if (!input.spec.scenario) throw new Error(`acceptance spec ${input.spec.id} has no scenario`)
  const model = await dependencies.resolveModel(input)
  const language = ProviderLLM.wrapModel(await dependencies.getLanguage(model, input), model, {})
  const result = dependencies.stream({
    model: language,
    tools: {
      submit_walkthrough_steps: tool({
        description: "Submit executable browser walkthrough steps for the acceptance scenario.",
        inputSchema: ProviderSchema.input(model, TranslateOutputSchema),
      }),
    },
    toolChoice: { type: "tool", toolName: "submit_walkthrough_steps" },
    prompt: [
      "Convert this Gherkin acceptance scenario into browser walkthrough steps.",
      "Use only: goto, fill, click, assertPath, assertSelector, assertText.",
      "assertPath uses path substring matching, so /chat matches /chat/abc123.",
      "Use assertSelector with present=false only for UI that must be absent.",
      "The final step must be assertPath or assertSelector.",
      "Example 1:",
      "Given: the login page is open; When: the user enters email and password and submits; Then: the chat page is visible",
      `Steps: ${JSON.stringify([
        { action: "goto", path: "/login" },
        { action: "fill", selector: "input[name='email']", value: "user@example.com" },
        { action: "fill", selector: "input[name='password']", value: "password" },
        { action: "click", selector: "button[type='submit']" },
        { action: "assertPath", path: "/chat" },
        { action: "assertSelector", selector: "[data-testid='chat-shell']" },
      ])}`,
      "Example 2:",
      "Given: the settings page is open; When: the user views the form; Then: no validation error is shown and the save button is present",
      `Steps: ${JSON.stringify([
        { action: "goto", path: "/settings" },
        { action: "assertSelector", selector: "[role='alert']", present: false },
        { action: "assertSelector", selector: "button[type='submit']" },
      ])}`,
      `Spec id: ${input.spec.id}`,
      `Title: ${input.spec.title}`,
      `Given: ${input.spec.scenario.given.join("; ")}`,
      `When: ${input.spec.scenario.when.join("; ")}`,
      `Then: ${input.spec.scenario.then.join("; ")}`,
    ].join("\n"),
    timeoutMs: 60_000,
  })
  let steps: WalkthroughStep[] | undefined
  for await (const part of result.fullStream) {
    if (isErrorPart(part)) throw new Error(`scenario walkthrough translation failed: ${String(part.error)}`)
    if (isToolCallPart(part) && part.toolName === "submit_walkthrough_steps") {
      steps = TranslateOutputSchema.parse(part.input).steps
    }
  }
  if (!steps) throw new Error(`scenario walkthrough translation did not submit steps for ${input.spec.id}`)
  const last = steps.at(-1)
  if (!last || (last.action !== "assertPath" && last.action !== "assertSelector")) {
    throw new Error("scenario walkthrough final step must be assertPath or assertSelector")
  }
  return WalkthroughStepsSchema.parse(steps)
}

function isToolCallPart(part: unknown): part is { type: string; toolName: string; input: unknown } {
  return (
    typeof part === "object" &&
    part !== null &&
    (part as { type?: unknown }).type === "tool-call" &&
    typeof (part as { toolName?: unknown }).toolName === "string" &&
    "input" in part
  )
}

function isErrorPart(part: unknown): part is { type: string; error: unknown } {
  return typeof part === "object" && part !== null && (part as { type?: unknown }).type === "error"
}

export function parseWalkthroughStep(input: unknown) {
  return WalkthroughStepSchema.parse(input)
}
