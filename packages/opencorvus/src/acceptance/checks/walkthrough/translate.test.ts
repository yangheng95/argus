import { describe, expect, test } from "bun:test"
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
})

function deps(parts: unknown[], prompts?: string[]): TranslateScenarioDependencies {
  return {
    resolveModel: async () =>
      ({ providerID: "test", id: "mock", api: { id: "mock" } }) as Awaited<
        ReturnType<TranslateScenarioDependencies["resolveModel"]>
      >,
    getLanguage: async () => "language-model" as Awaited<ReturnType<TranslateScenarioDependencies["getLanguage"]>>,
    stream: ((input: { prompt?: string }) => {
      if (input.prompt) prompts?.push(input.prompt)
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
