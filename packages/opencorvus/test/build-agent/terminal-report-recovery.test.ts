import { afterEach, expect, mock, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

let runnerImpl: ((input: any) => Promise<any>) | undefined

mock.module("@/agent/runner", () => ({
  runAgentSession: (input: any) => {
    if (!runnerImpl) throw new Error("runAgentSession mock not configured")
    return runnerImpl(input)
  },
}))

afterEach(async () => {
  runnerImpl = undefined
  mock.restore()
  await Instance.disposeAll()
})

test("BuildAgent keeps the build session alive for missing report_build_result recovery", async () => {
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      runnerImpl = async (input: any) => {
        expect(input.terminalTool?.toolName).toBe("report_build_result")
        expect(input.terminalTool?.recovery?.maxTurns).toBe(3)

        const prompt = input.terminalTool.recovery.buildUserPrompt({
          collector: input.toolKit.getCollector(),
          toolName: "report_build_result",
          attempt: 1,
          finalMessage: { info: { role: "assistant" } },
        })
        expect(prompt).toContain("same build session")
        expect(prompt).toContain("report_build_result")
        expect(prompt).toContain("files_changed[]")
        expect(prompt).toContain(".opencorvus/worktrees")

        input.toolKit.getCollector().result = {
          status: "failed",
          summary: "reported after same-session recovery",
          files_changed: [],
          tests: [],
          error: "test harness stops before implementation",
        }
        return {
          session: { id: "ses_build_recovery" },
          finalMessage: { info: { role: "assistant" } },
          collector: input.toolKit.getCollector(),
          structured: undefined,
          streamErrors: [],
          model: { providerID: "test", modelID: "test", id: "test" },
          requiredTools: [],
        }
      }

      const { BuildAgent } = await import("../../src/build/agent")
      const out = await BuildAgent.run({
        workDir: tmp.path,
        task: {
          id: "tsk_build_recovery",
          request: "build a tiny app",
          title: "build recovery",
          executor: "mirrorcode",
          attachments: [],
          budget: { max_executor_groups: 1 },
        } as any,
        target: {
          kind: "request",
          text: "build a tiny app",
        },
      })

      expect(out.sessionID).toBe("ses_build_recovery")
      expect(out.result.status).toBe("failed")
      expect(out.result.summary).toContain("reported after same-session recovery")
    },
  })
})
