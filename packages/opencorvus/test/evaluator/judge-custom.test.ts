import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { judgeResult } from "../../src/evaluator/review"
import { Provider } from "../../src/provider/provider"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import * as ai from "ai"

Log.init({ print: false })

describe("judge custom acceptance criteria", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
  })

  function mockJudgeModel() {
    const modelDef = { providerID: "test", id: "test-judge", modelID: "test-judge" }
    spyOn(Provider, "defaultModel").mockResolvedValue(modelDef)
    spyOn(Provider, "getModel").mockResolvedValue(modelDef)
    // getLanguage needs to return something truthy so judgeResult proceeds
    spyOn(Provider, "getLanguage").mockResolvedValue({} as any)
  }

  test("judge accepts delivery when LLM verdict is accepted", async () => {
    await using tmp = await tmpdir({ git: true })

    mockJudgeModel()
    const generateSpy = spyOn(ai, "generateObject").mockResolvedValue({
      object: {
        verdict: "accepted",
        rationale: "The project starts automatically after generation.",
        strengths: ["Auto-start configured"],
        concerns: [],
      },
    } as any)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await judgeResult(
          { enabled: true, prompt: "项目生成结束必须能够自动启动", mode: "strict" },
          "Create a web server project",
          {
            summary: "Created Express server with auto-start script in package.json",
            changedFiles: ["src/index.ts", "package.json"],
            diffs: [],
          },
        )

        expect(result.outcome).toBe("passed")
        const check = result.checks[0]
        expect(check?.name).toBe("judge")
        expect(check?.status).toBe("passed")
        expect(check?.evidence).toContain("automatically")
        expect(generateSpy).toHaveBeenCalledTimes(1)
      },
    })
  })

  test("judge rejects delivery when LLM verdict is rejected", async () => {
    await using tmp = await tmpdir({ git: true })

    mockJudgeModel()
    spyOn(ai, "generateObject").mockResolvedValue({
      object: {
        verdict: "rejected",
        rationale: "No auto-start mechanism found. The project requires manual startup.",
        strengths: [],
        concerns: ["Missing start script"],
      },
    } as any)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = await judgeResult(
          { enabled: true, prompt: "项目生成结束必须能够自动启动", mode: "strict" },
          "Create a web server project",
          {
            summary: "Created basic Express server files",
            changedFiles: ["src/index.ts"],
            diffs: [],
          },
        )

        expect(result.outcome).toBe("failed")
        const check = result.checks[0]
        expect(check?.name).toBe("judge")
        expect(check?.status).toBe("failed")
      },
    })
  })

  test("custom prompt is included in the LLM request", async () => {
    await using tmp = await tmpdir({ git: true })

    const customPrompt = "所有 API 端点必须有认证保护"

    mockJudgeModel()
    const generateSpy = spyOn(ai, "generateObject").mockResolvedValue({
      object: {
        verdict: "accepted",
        rationale: "All endpoints are authenticated.",
      },
    } as any)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await judgeResult(
          { enabled: true, prompt: customPrompt, mode: "soft" },
          "Build a REST API",
          {
            summary: "Built REST API with JWT auth",
            changedFiles: ["src/api.ts", "src/auth.ts"],
            diffs: [],
          },
        )

        expect(generateSpy).toHaveBeenCalledTimes(1)
        const callArgs = generateSpy.mock.calls[0]![0] as any
        const userMsg = callArgs.messages.find((m: any) => m.role === "user")
        expect(userMsg.content).toContain(customPrompt)
      },
    })
  })

  test("judge is skipped when enabled=false", async () => {
    const result = await judgeResult(
      { enabled: false },
      "some request",
      { summary: "some delivery" },
    )

    // emptyOptional returns passed outcome with empty checks (no-op)
    expect(result.checks).toHaveLength(0)
  })
})
