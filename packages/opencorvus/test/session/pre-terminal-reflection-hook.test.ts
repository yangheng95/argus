import { describe, expect, test } from "bun:test"
import { tool } from "ai"
import z from "zod"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionLoop } from "../../src/session/loop"
import { Agent } from "../../src/agent/agent"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
void SessionPrompt

describe("pre-terminal reflection hook", () => {
  test("returns a visible terminal-tool reflection result once per finalizer marker", () => {
    const first = SessionLoop.takePreTerminalReflection({
      sessionID: "ses_reflection_terminal",
      agentName: "build",
      finalizerName: "report_build_result",
      markerID: "attempt-1",
    })
    const second = SessionLoop.takePreTerminalReflection({
      sessionID: "ses_reflection_terminal",
      agentName: "build",
      finalizerName: "report_build_result",
      markerID: "attempt-1",
    })

    expect(first?.title).toBe("Pre-terminal Reflection Required")
    expect(first?.output).toContain("This terminal submission is paused")
    expect(first?.output).toContain("# Pre-terminal Reflection")
    expect(first?.output).toContain("report_build_result")
    expect(first?.output).toContain("call report_build_result again")
    expect(first?.metadata).toEqual({
      preTerminalReflection: true,
      agentName: "build",
      finalizerName: "report_build_result",
    })
    expect(second).toBeUndefined()
  })

  test("StructuredOutput first valid call triggers reflection before capture", async () => {
    const captured: unknown[] = []
    const tool = SessionLoop.createStructuredOutputTool({
      schema: {
        type: "object",
        properties: { summary: { type: "string" } },
        required: ["summary"],
      },
      preTerminalReflection: () =>
        SessionLoop.takePreTerminalReflection({
          sessionID: "ses_reflection_structured",
          agentName: "intent-analysis",
          finalizerName: "StructuredOutput",
          markerID: "msg-1",
        }),
      onSuccess: (output) => {
        captured.push(output)
      },
    }) as any

    const first = await tool.execute({ summary: "done" })
    const second = await tool.execute({ summary: "done" })
    const malformedAfterReflection = await tool.execute({})
    expect(captured).toEqual([])
    const nextTurnTool = SessionLoop.createStructuredOutputTool({
      schema: {
        type: "object",
        properties: { summary: { type: "string" } },
        required: ["summary"],
      },
      preTerminalReflection: () =>
        SessionLoop.takePreTerminalReflection({
          sessionID: "ses_reflection_structured",
          agentName: "intent-analysis",
          finalizerName: "StructuredOutput",
          markerID: "msg-1",
        }),
      onSuccess: (output) => {
        captured.push(output)
      },
    }) as any
    const third = await nextTurnTool.execute({ summary: "done" })

    expect(first.title).toBe("Pre-terminal Reflection Required")
    expect(first.output).toContain("StructuredOutput")
    expect(second.title).toBe("Pre-terminal Reflection Required")
    expect(malformedAfterReflection.title).toBe("Pre-terminal Reflection Required")
    expect(captured).toEqual([{ summary: "done" }])
    expect(third.title).toBe("Structured Output")
  })

  test("runtime terminal extra tool executes directly without pre-submit reflection", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = `ses_pre_terminal_extra_${Date.now()}`
        let executed = 0
        SessionLoop.setSessionRuntimeContract(sessionID, {
          identity: {
            sessionID,
            agentKind: "build",
            contractKind: "stage-attempt",
            installedAt: Date.now(),
          },
          tools: {
            report_build_result: tool({
              description: "terminal report",
              inputSchema: z.object({ status: z.enum(["passed", "failed"]) }),
              async execute(args) {
                executed += 1
                return `RECORDED: ${args.status}`
              },
            }),
          },
          terminalToolContract: {
            toolName: "report_build_result",
            isSatisfied: () => false,
            shouldExposeOnlyTerminalTool: () => false,
          },
        })

        const resolved = await SessionLoop.resolveTools({
          agent: (await Agent.get("build"))!,
          model: {
            providerID: "test",
            id: "test",
            api: { id: "test", npm: "@ai-sdk/openai" },
            capabilities: { input: {}, reasoning: false },
          } as any,
          session: { id: sessionID, kind: "build", permission: [] } as any,
          processor: {
            message: { id: "msg_pre_terminal_extra" },
            partFromToolCall: () => undefined,
            ensureToolPart: async () => undefined,
          } as any,
          bypassAgentCheck: false,
          messages: [],
        })

        const terminal = resolved.report_build_result as any
        const first = await terminal.execute({ status: "passed" }, { toolCallId: "call_1" })

        expect(first.output).toBe("RECORDED: passed")
        expect(executed).toBe(1)
        SessionLoop.clearSessionRuntimeContract(sessionID)
      },
    })
  })
})
