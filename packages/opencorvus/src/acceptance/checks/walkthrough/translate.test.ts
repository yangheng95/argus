import { describe, expect, test } from "bun:test"
import { asSchema } from "ai"
import { translateScenarioToStepsWithDependencies, type TranslateScenarioDependencies } from "./translate"

describe("scenario walkthrough translation", () => {
  test("accepts validated streaming tool-call steps", async () => {
    const steps = await translateScenarioToStepsWithDependencies(
      { spec: scenarioSpec() },
      deps([
        {
          type: "tool-call",
          toolName: "submit_walkthrough_steps",
          input: {
            steps: [
              { action: "goto", path: "/" },
              { action: "assertSelector", selector: "#app" },
            ],
          },
        },
      ]),
    )
    expect(steps.at(-1)).toEqual({ action: "assertSelector", selector: "#app" })
  })

  test("requires final path or selector assertion", async () => {
    await expect(
      translateScenarioToStepsWithDependencies(
        { spec: scenarioSpec() },
        deps([
          {
            type: "tool-call",
            toolName: "submit_walkthrough_steps",
            input: {
              steps: [
                { action: "goto", path: "/" },
                { action: "assertText", text: "Ready" },
              ],
            },
          },
        ]),
      ),
    ).rejects.toThrow("final step")
  })

  test("rejects invalid actions", async () => {
    await expect(
      translateScenarioToStepsWithDependencies(
        { spec: scenarioSpec() },
        deps([
          {
            type: "tool-call",
            toolName: "submit_walkthrough_steps",
            input: { steps: [{ action: "hover", selector: "#app" }] },
          },
        ]),
      ),
    ).rejects.toThrow()
  })

  test("includes worked examples and selector absence guidance in the streaming prompt", async () => {
    const prompts: string[] = []
    await translateScenarioToStepsWithDependencies(
      { spec: scenarioSpec() },
      deps(
        [
          {
            type: "tool-call",
            toolName: "submit_walkthrough_steps",
            input: {
              steps: [
                { action: "goto", path: "/" },
                { action: "assertSelector", selector: "#app" },
              ],
            },
          },
        ],
        prompts,
      ),
    )
    expect(prompts[0]).toContain("Example 1:")
    expect(prompts[0]).toContain('"assertPath","path":"/chat"')
    expect(prompts[0]).toContain('"present":false')
  })

  test("does not accept retired args-only tool-call parts as successful translation", async () => {
    await expect(
      translateScenarioToStepsWithDependencies(
        { spec: scenarioSpec() },
        deps([
          {
            type: "tool-call",
            toolName: "submit_walkthrough_steps",
            args: {
              steps: [
                { action: "goto", path: "/" },
                { action: "assertSelector", selector: "#app" },
              ],
            },
          },
        ]),
      ),
    ).rejects.toThrow("did not submit steps")
  })

  test("sends a provider-normalized walkthrough tool schema", async () => {
    const calls: any[] = []
    await translateScenarioToStepsWithDependencies(
      { spec: scenarioSpec() },
      deps(
        [
          {
            type: "tool-call",
            toolName: "submit_walkthrough_steps",
            input: {
              steps: [
                { action: "goto", path: "/" },
                { action: "assertSelector", selector: "#app" },
              ],
            },
          },
        ],
        undefined,
        calls,
      ),
    )
    const schema = asSchema(calls[0].tools.submit_walkthrough_steps.inputSchema).jsonSchema as any
    const presentSchema = findPropertySchema(schema, "present")

    expect(schema.required).toContain("steps")
    expect(schema.additionalProperties).toBe(false)
    expect(presentSchema?.anyOf).toContainEqual({ type: "null" })
  })
})

function deps(parts: unknown[], prompts?: string[], calls?: unknown[]): TranslateScenarioDependencies {
  return {
    resolveModel: async () =>
      ({
        providerID: "hexin",
        id: "hexin/gpt-5.5",
        api: { id: "gpt-5.5", npm: "@ai-sdk/openai-compatible" },
      }) as Awaited<ReturnType<TranslateScenarioDependencies["resolveModel"]>>,
    getLanguage: async () => "language-model" as Awaited<ReturnType<TranslateScenarioDependencies["getLanguage"]>>,
    stream: ((input: { prompt?: string }) => {
      if (input.prompt) prompts?.push(input.prompt)
      calls?.push(input)
      return { fullStream: stream(parts) }
    }) as unknown as TranslateScenarioDependencies["stream"],
  }
}

async function* stream(parts: unknown[]) {
  for (const part of parts) yield part
}

function scenarioSpec() {
  return {
    id: "acc-runtime",
    source_requirement_id: "REQ-runtime",
    goal_id: "gol-runtime",
    title: "Runtime scenario",
    scenario: { given: ["the app is open"], when: ["the user views it"], then: ["the app is visible"] },
    scorers: [
      {
        type: "llm_judge" as const,
        name: "runtime_behavior",
        criteria: "The runtime page satisfies the described scenario.",
      },
    ],
    severity: "essential" as const,
  }
}

function findPropertySchema(schema: unknown, property: string): any {
  if (!schema || typeof schema !== "object") return undefined
  if (Array.isArray(schema)) {
    for (const item of schema) {
      const found = findPropertySchema(item, property)
      if (found) return found
    }
    return undefined
  }
  const record = schema as Record<string, unknown>
  const properties = record.properties
  if (properties && typeof properties === "object" && property in properties) {
    return (properties as Record<string, unknown>)[property]
  }
  for (const value of Object.values(record)) {
    const found = findPropertySchema(value, property)
    if (found) return found
  }
  return undefined
}
