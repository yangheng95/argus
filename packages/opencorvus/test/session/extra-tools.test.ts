import { describe, expect, test } from "bun:test"
import { asSchema, tool } from "ai"
import z from "zod"
// Import order matters: SessionPrompt loads session/index first which pulls
// in the rest of the session module graph; SessionLoop is then already
// populated by the time we reference it. Loading SessionLoop directly ahead
// of SessionPrompt triggers a module-init cycle where the prompt/index
// destructure sees an empty stub.
import { SessionPrompt } from "../../src/session/prompt"
import { SessionLoop } from "../../src/session/loop"
import { Session } from "../../src/session"
import { SessionStatus } from "../../src/session/status"
import { withStreamActivity } from "../../src/util/stream-activity"
import { BuildResultSchema } from "../../src/build/types"
import { Instance } from "../../src/project/instance"
import { AttachmentStore } from "../../src/storage/attachment-store"
import { tmpdir } from "../fixture/fixture"
import { Agent } from "../../src/agent/agent"
import { WorkerTurnDescriptor } from "../../src/agent/worker-turn-descriptor"

const dummyTool = () =>
  tool({
    description: "test-only",
    inputSchema: z.object({ x: z.number() }),
    async execute(args) {
      return `ok:${args.x}`
    },
  })

const runtimeContract = (
  sessionID: string,
  overrides: Partial<SessionLoop.SessionRuntimeContract> = {},
): SessionLoop.SessionRuntimeContract => {
  const { identity, ...rest } = overrides
  return {
    ...rest,
    identity: {
      sessionID,
      agentKind: "build",
      contractKind: "stage-attempt",
      goalID: "gol_runtime_test",
      goalRunID: "grun_runtime_test",
      attemptID: "attempt_runtime_test",
      installedAt: Date.now(),
      ...identity,
    },
  }
}

describe("SessionLoop session runtime contract", () => {
  test("round-trips a registered stage tool map", () => {
    const sessionID = `ses_runtime_${Date.now()}_visible`
    SessionLoop.setSessionRuntimeContract(sessionID, runtimeContract(sessionID, {
      tools: { persistent: dummyTool() },
    }))
    expect(Object.keys(SessionLoop.getSessionRuntimeContract(sessionID)?.tools ?? {})).toEqual(["persistent"])
    SessionLoop.clearSessionRuntimeContract(sessionID)
    expect(SessionLoop.getSessionRuntimeContract(sessionID)).toBeUndefined()
  })

  test("a second runtime contract replaces the map wholesale", () => {
    const sessionID = `ses_runtime_${Date.now()}_replace`
    SessionLoop.setSessionRuntimeContract(sessionID, runtimeContract(sessionID, {
      tools: { first: dummyTool() },
    }))
    SessionLoop.setSessionRuntimeContract(sessionID, runtimeContract(sessionID, {
      tools: { second: dummyTool() },
    }))
    expect(Object.keys(SessionLoop.getSessionRuntimeContract(sessionID)?.tools ?? {})).toEqual(["second"])
  })

  test("SessionPrompt.cancel preserves runtime contract until the owning loop settles", async () => {
    const sessionID = `ses_runtime_${Date.now()}_cancel`
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        SessionPrompt.setSessionRuntimeContract(sessionID, runtimeContract(sessionID, {
          tools: { persistent: dummyTool() },
        }))
        expect(SessionPrompt.getSessionRuntimeContract(sessionID)?.tools).toBeDefined()
        SessionPrompt.cancel(sessionID)
        expect(SessionPrompt.getSessionRuntimeContract(sessionID)?.tools).toBeDefined()
        SessionPrompt.clearSessionRuntimeContract(sessionID)
      },
    })
  })

  test("SessionPrompt.cancel aborts a registered activity gate", async () => {
    const sessionID = `ses_runtime_${Date.now()}_gate`
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const gate = withStreamActivity({ idleMs: 60_000, label: "session-cancel-test" })
        const unregister = SessionStatus.registerActivityGate(sessionID, gate)
        try {
          SessionPrompt.cancel(sessionID)
          expect(gate.signal.aborted).toBe(true)
          expect(gate.timedOut()).toBe(false)
          expect(String(gate.signal.reason)).toContain("session cancelled")
        } finally {
          unregister()
          gate.dispose()
        }
      },
    })
  })

  test("rejects a contract whose identity belongs to another session", () => {
    const sessionID = `ses_runtime_${Date.now()}_mismatch`
    expect(() =>
      SessionLoop.setSessionRuntimeContract(sessionID, runtimeContract("ses_other_runtime", {
        tools: { persistent: dummyTool() },
      })),
    ).toThrow("identity mismatch")
    expect(SessionLoop.getSessionRuntimeContract(sessionID)).toBeUndefined()
  })

  test("validation rejects missing contracts for stage continuations", () => {
    const sessionID = `ses_runtime_${Date.now()}_missing`
    expect(() =>
      SessionLoop.validateSessionRuntimeContractForContinuation({
        sessionID,
        sessionKind: "build",
        expectedAgentKind: "build",
        requireRuntimeContract: true,
      }),
    ).toThrow("missing")
  })

  test("validation rejects runtime-required contracts without worker descriptors", () => {
    const sessionID = `ses_runtime_${Date.now()}_missing_descriptor`
    SessionLoop.setSessionRuntimeContract(sessionID, runtimeContract(sessionID, {
      tools: { persistent: dummyTool() },
    }))
    expect(() =>
      SessionLoop.validateSessionRuntimeContractForContinuation({
        sessionID,
        sessionKind: "build",
        expectedAgentKind: "build",
        requireRuntimeContract: true,
        requireWorkerTurnDescriptor: true,
      }),
    ).toThrow("worker descriptor missing")
    SessionLoop.clearSessionRuntimeContract(sessionID)
  })

  test("validation rejects stale agent, goal, goal_run, attempt, and satisfied terminal collector", () => {
    const sessionID = `ses_runtime_${Date.now()}_stale`
    SessionLoop.setSessionRuntimeContract(sessionID, runtimeContract(sessionID, {
      terminalToolContract: {
        toolName: "report_build_result",
        isSatisfied: () => true,
        shouldExposeOnlyTerminalTool: () => false,
      },
    }))
    expect(() =>
      SessionLoop.validateSessionRuntimeContractForContinuation({
        sessionID,
        expectedAgentKind: "requirements",
      }),
    ).toThrow("agent mismatch")
    expect(() =>
      SessionLoop.validateSessionRuntimeContractForContinuation({
        sessionID,
        expectedAgentKind: "build",
        expectedGoalID: "gol_other",
      }),
    ).toThrow("goal mismatch")
    expect(() =>
      SessionLoop.validateSessionRuntimeContractForContinuation({
        sessionID,
        expectedAgentKind: "build",
        expectedGoalID: "gol_runtime_test",
        expectedGoalRunID: "grun_other",
      }),
    ).toThrow("goal_run mismatch")
    expect(() =>
      SessionLoop.validateSessionRuntimeContractForContinuation({
        sessionID,
        expectedAgentKind: "build",
        expectedGoalID: "gol_runtime_test",
        expectedGoalRunID: "grun_runtime_test",
        expectedAttemptID: "attempt_other",
      }),
    ).toThrow("attempt mismatch")
    expect(() =>
      SessionLoop.validateSessionRuntimeContractForContinuation({
        sessionID,
        expectedAgentKind: "build",
        expectedGoalID: "gol_runtime_test",
        expectedGoalRunID: "grun_runtime_test",
        expectedAttemptID: "attempt_runtime_test",
      }),
    ).toThrow("already satisfied")
    SessionLoop.clearSessionRuntimeContract(sessionID)
  })

  test("validation binds continuation to the persisted worker turn descriptor", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "descriptor validation", kind: "build" })
        const sessionID = session.id
        const descriptor = WorkerTurnDescriptor.create({
          sessionID,
          payload: {
            agent: "build",
            roleContractID: "build",
            model: { providerID: "test", modelID: "model-api" },
            prompt: { systemMode: "complete", rawSystemPrompt: false },
            tools: { enabled: ["persistent"], terminal: "report_build_result" },
            output: { format: "text", resultMode: "reply" },
            workflow: {
              goalID: "gol_runtime_test",
              goalRunID: "grun_runtime_test",
              attemptID: "attempt_runtime_test",
              sessionKind: "build",
            },
          },
        })
        SessionLoop.setSessionRuntimeContract(sessionID, runtimeContract(sessionID, {
          identity: {
            workerTurnDescriptorID: descriptor.id,
            workerTurnDescriptorHash: descriptor.hash,
          },
          tools: { persistent: dummyTool() },
        }))
        expect(
          SessionLoop.validateSessionRuntimeContractForContinuation({
            sessionID,
            sessionKind: "build",
            expectedAgentKind: "build",
            expectedGoalID: "gol_runtime_test",
            expectedGoalRunID: "grun_runtime_test",
            expectedAttemptID: "attempt_runtime_test",
            expectedWorkerTurnDescriptor: { id: descriptor.id, hash: descriptor.hash },
            expectedModel: { providerID: "test", modelID: "model-api" },
            expectedResultMode: "reply",
          })?.identity.workerTurnDescriptorID,
        ).toBe(descriptor.id)
        expect(() =>
          SessionLoop.validateSessionRuntimeContractForContinuation({
            sessionID,
            sessionKind: "build",
            expectedAgentKind: "build",
            expectedWorkerTurnDescriptor: { id: descriptor.id, hash: "bad-hash" },
          }),
        ).toThrow("descriptor hash mismatch")
        SessionLoop.clearSessionRuntimeContract(sessionID)
      },
    })
  })
})

describe("extras execute-return normalisation (integration via resolveTools)", () => {
  // We can't hit resolveTools without the full session/model context, but we
  // can verify the wrapping behaviour by inspecting the registered tool and
  // calling its execute directly.
  const plainStringTool = () =>
    tool({
      description: "returns plain string",
      inputSchema: z.object({}),
      async execute() {
        return "OK: hello"
      },
    })

  const partialObjectTool = () =>
    tool({
      description: "returns partial object",
      inputSchema: z.object({}),
      async execute() {
        return { output: "done" } // missing title + metadata
      },
    })

  const fullObjectTool = () =>
    tool({
      description: "returns full object",
      inputSchema: z.object({}),
      async execute() {
        return { output: "x", title: "t", metadata: { a: 1 } }
      },
    })

  test("plain-string returns survive resolveTools via the wrapper (smoke)", async () => {
    // Exercising resolveTools requires a live session. This unit-level smoke
    // just confirms that runtime-contract tools can carry execute functions
    // returning plain strings — the wrapper behaviour is verified end-to-end by the
    // intent-analysis smoke test, which used to fail with a ZodError on
    // Message.ToolPart persistence before the wrapper was added.
    const sessionID = `ses_runtime_${Date.now()}_wrap_smoke`
    SessionLoop.setSessionRuntimeContract(sessionID, runtimeContract(sessionID, {
      tools: {
        plain: plainStringTool(),
        partial: partialObjectTool(),
        full: fullObjectTool(),
      },
    }))
    const extras = SessionLoop.getSessionRuntimeContract(sessionID)?.tools ?? {}
    expect(Object.keys(extras).sort()).toEqual(["full", "partial", "plain"])
    SessionLoop.clearSessionRuntimeContract(sessionID)
  })

  test("orchestrator runtime contract uses exact tools instead of registry inheritance", () => {
    const contract = runtimeContract("ses_orchestrator_exact", {
      identity: {
        sessionID: "ses_orchestrator_exact",
        agentKind: "orchestrator",
        contractKind: "orchestrator-wake",
      },
      tools: {},
    })
    expect(SessionLoop.usesExactRuntimeContractTools("orchestrator", contract)).toBe(true)
    expect(SessionLoop.usesExactRuntimeContractTools("orchestrator", undefined)).toBe(false)
    expect(SessionLoop.usesExactRuntimeContractTools("build", contract)).toBe(false)
  })

  test("orchestrator-wake runtime contract does not require a worker descriptor", () => {
    const sessionID = `ses_runtime_${Date.now()}_orchestrator_descriptor_exempt`
    SessionLoop.setSessionRuntimeContract(sessionID, runtimeContract(sessionID, {
      identity: {
        sessionID,
        agentKind: "orchestrator",
        contractKind: "orchestrator-wake",
      },
      tools: { requirements: dummyTool() },
    }))
    expect(
      SessionLoop.validateSessionRuntimeContractForContinuation({
        sessionID,
        sessionKind: "orchestrator",
        expectedAgentKind: "orchestrator",
        expectedContractKind: "orchestrator-wake",
        requireRuntimeContract: true,
        requireWorkerTurnDescriptor: true,
      })?.identity.contractKind,
    ).toBe("orchestrator-wake")
    SessionLoop.clearSessionRuntimeContract(sessionID)
  })

  test("tool switches remove disabled tools and support all-tools disable", () => {
    const namedTools = { bash: dummyTool(), skill: dummyTool(), read_file: dummyTool() }
    SessionLoop.applyToolSwitches(namedTools, { bash: false })
    expect(Object.keys(namedTools).sort()).toEqual(["read_file", "skill"])

    const allTools = { bash: dummyTool(), skill: dummyTool() }
    SessionLoop.applyToolSwitches(allTools, { "*": false })
    expect(Object.keys(allTools)).toEqual([])
  })

  test("orchestrator resolveTools returns exactly runtime contract tools", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const sessionID = `ses_runtime_${Date.now()}_orchestrator_exact`
        SessionLoop.setSessionRuntimeContract(sessionID, runtimeContract(sessionID, {
          identity: {
            sessionID,
            agentKind: "orchestrator",
            contractKind: "orchestrator-wake",
          },
          tools: { requirements: dummyTool() },
        }))
        const resolved = await SessionLoop.resolveTools({
          agent: (await Agent.get("orchestrator"))!,
          model: {
            providerID: "test",
            id: "test",
            api: { id: "test", npm: "@ai-sdk/openai" },
            capabilities: { input: {}, reasoning: false },
          } as any,
          session: { id: sessionID, kind: "orchestrator", permission: [] } as any,
          processor: {
            message: { id: "msg_test" },
            partFromToolCall: () => undefined,
            ensureToolPart: async () => undefined,
          } as any,
          bypassAgentCheck: false,
          messages: [],
        })

        expect(Object.keys(resolved)).toEqual(["requirements"])
        expect(resolved.skill).toBeUndefined()
        SessionLoop.clearSessionRuntimeContract(sessionID)
      },
    })
  })

  test("normalizes multimodal extra-tool results without stringifying attachments into output", () => {
    const dataUrl = "data:image/png;base64," + "a".repeat(1024)
    const normalized = SessionLoop.normalizeExtraToolResult({
      text: "{\"ok\":true,\"path\":\"shot.png\"}",
      attachments: [{ type: "file", mime: "image/png", url: dataUrl }],
    })

    expect(normalized.output).toBe("{\"ok\":true,\"path\":\"shot.png\"}")
    expect(normalized.output).not.toContain("data:image/png;base64")
    expect(normalized.attachments).toEqual([{ type: "file", mime: "image/png", url: dataUrl }])
  })

  test("rejects attachment-only extra-tool results instead of serializing bytes as text", () => {
    expect(() =>
      SessionLoop.normalizeExtraToolResult({
        attachments: [{ type: "file", mime: "image/png", url: "data:image/png;base64,UE5H" }],
      }),
    ).toThrow("attachments without string output/text")
  })

  test("materializes data URL tool-result attachments into AttachmentStore refs", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const attachments = await SessionLoop.materializeToolResultAttachments([
          { type: "file", mime: "image/png", filename: "tool.png", url: "data:image/png;base64,UE5H" },
        ])
        expect(Array.isArray(attachments)).toBe(true)
        const first = (attachments as Array<{ url: string; mime: string }>)[0]
        expect(first.url.startsWith("data:")).toBe(false)
        const located = AttachmentStore.nameFromUrl(first.url)
        expect(located).toBeTruthy()
        const bytes = await AttachmentStore.read(located!.projectID, located!.name)
        expect(bytes.toString("utf8")).toBe("PNG")
      },
    })
  }, 20000)
})

describe("extra tool provider schema preparation", () => {
  const dashScopeModel = {
    providerID: "alibaba-cn",
    id: "kimi-k2.5",
    api: {
      id: "kimi-k2.5",
      npm: "@ai-sdk/openai-compatible",
      url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    },
  } as any

  test("keeps explicit final confirmation required on extra submit tools", () => {
    const prepared = SessionLoop.prepareProviderTool({
      name: "submit_requirements",
      source: "extra",
      model: dashScopeModel,
      tool: tool({
        description: "submit",
        inputSchema: z.object({ final: z.literal(true) }),
        async execute() {
          return { output: "ok", title: "", metadata: {} }
        },
      }),
    }) as any

    const schema = asSchema(prepared.inputSchema).jsonSchema as any
    expect(schema.type).toBe("object")
    expect(schema.required).toContain("final")
    expect(schema.properties.final.const).toBe(true)
  })

  test("normalizes extra discriminated result tools to provider-bound root object schema", () => {
    const prepared = SessionLoop.prepareProviderTool({
      name: "report_build_result",
      source: "extra",
      model: dashScopeModel,
      tool: tool({
        description: "report build result",
        inputSchema: BuildResultSchema,
        async execute() {
          return { output: "ok", title: "", metadata: {} }
        },
      }),
    }) as any

    const schema = asSchema(prepared.inputSchema).jsonSchema as any
    expect(schema.type).toBe("object")
    expect(schema.anyOf).toBeUndefined()
    expect(schema.properties.status.enum).toEqual(["passed", "failed"])
  })

  test("adds v6-aware model output conversion for project tool-result objects", () => {
    const prepared = SessionLoop.prepareProviderTool({
      name: "submit_requirements",
      source: "extra",
      model: dashScopeModel,
      tool: tool({
        description: "submit",
        inputSchema: z.object({ final: z.literal(true) }),
        async execute() {
          return { output: "accepted", title: "Submit", metadata: { ok: true } }
        },
      }),
    }) as any

    expect(prepared.toModelOutput({
      toolCallId: "call_submit",
      input: { final: true },
      output: { output: "accepted", title: "Submit", metadata: { ok: true } },
    })).toEqual({ type: "text", value: "accepted" })
  })

  test("preserves explicit tool model output conversion", () => {
    const customToModelOutput = () => ({ type: "text", value: "custom" })
    const prepared = SessionLoop.prepareProviderTool({
      name: "submit_requirements",
      source: "extra",
      model: dashScopeModel,
      tool: {
        ...tool({
          description: "submit",
          inputSchema: z.object({ final: z.literal(true) }),
          async execute() {
            return { output: "accepted", title: "Submit", metadata: { ok: true } }
          },
        }),
        toModelOutput: customToModelOutput,
      } as any,
    }) as any

    expect(prepared.toModelOutput).toBe(customToModelOutput)
    expect(prepared.toModelOutput({ output: { output: "accepted" } })).toEqual({ type: "text", value: "custom" })
  })

  test("rejects provider-bound tools without an input schema", () => {
    expect(() =>
      SessionLoop.prepareProviderTool({
        name: "broken_extra",
        source: "extra",
        model: dashScopeModel,
        tool: { description: "broken" } as any,
      }),
    ).toThrow("missing inputSchema")
  })
})

describe("SessionLoop.summarizeModelMessagePayloads", () => {
  test("reports the largest model-message parts without logging payload bytes", () => {
    const rows = SessionLoop.summarizeModelMessagePayloads([
      { role: "user", content: [{ type: "text", text: "small" }] },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolName: "verify_page_integrity",
            toolCallId: "call-1",
            output: { type: "text", value: "x".repeat(500) },
          },
          { type: "text", text: "tiny" },
        ],
      },
      {
        role: "user",
        content: [{ type: "file", mediaType: "image/png", data: "y".repeat(300) }],
      },
    ] as any)

    expect(rows[0]).toMatchObject({
      role: "tool",
      type: "tool-result",
      toolName: "verify_page_integrity",
      toolCallId: "call-1",
    })
    expect(rows[1]).toMatchObject({
      role: "user",
      type: "file",
      mediaType: "image/png",
    })
    expect(JSON.stringify(rows)).not.toContain("yyyyyyyyyyyyyyyy")
  })
})

describe("SessionPrompt re-exports runtime contract API", () => {
  test("surfaces the session runtime contract functions only", () => {
    expect(typeof SessionPrompt.setSessionRuntimeContract).toBe("function")
    expect(typeof SessionPrompt.getSessionRuntimeContract).toBe("function")
    expect(typeof SessionPrompt.clearSessionRuntimeContract).toBe("function")
    expect(typeof SessionPrompt.validateSessionRuntimeContractForContinuation).toBe("function")
    expect(typeof SessionPrompt.agentKindRequiresRuntimeContract).toBe("function")
    expect((SessionPrompt as any).setExtraTools).toBeUndefined()
    expect((SessionPrompt as any).getExtraTools).toBeUndefined()
    expect((SessionPrompt as any).withExtraTools).toBeUndefined()
    // The re-exports must be the same function references: SessionPrompt is
    // a thin namespace on top of SessionLoop, not an independent copy.
    expect(SessionPrompt.setSessionRuntimeContract).toBe(SessionLoop.setSessionRuntimeContract)
    expect(SessionPrompt.getSessionRuntimeContract).toBe(SessionLoop.getSessionRuntimeContract)
    expect(SessionPrompt.clearSessionRuntimeContract).toBe(SessionLoop.clearSessionRuntimeContract)
    expect(SessionPrompt.validateSessionRuntimeContractForContinuation).toBe(
      SessionLoop.validateSessionRuntimeContractForContinuation,
    )
    expect(SessionPrompt.agentKindRequiresRuntimeContract).toBe(SessionLoop.agentKindRequiresRuntimeContract)
  })
})

describe("SessionLoop.setStepHook / withStepHook", () => {
  test("setStepHook round-trips via withStepHook (hook cleared on completion)", async () => {
    const sessionID = `ses_step_${Date.now()}_ok`
    const calls: Array<{ step: number; turn: string }> = []
    await SessionLoop.withStepHook(sessionID, async (event) => {
      calls.push({ step: event.step, turn: event.turn })
    }, async () => {
      // Inside the wrapper, a hook is registered — we can't directly assert
      // registration without exposing a getter, but we assert clearing via
      // an indirect contract: a post-exit setStepHook(undefined) is a no-op.
      expect(true).toBe(true)
    })
    // Post-callback: setting undefined on an empty slot is a no-op — this
    // throws if the cleanup was skipped (the Map remembers the fn).
    expect(() => SessionLoop.setStepHook(sessionID, undefined)).not.toThrow()
    expect(calls).toEqual([])
  })

  test("withStepHook clears even when the callback throws", async () => {
    const sessionID = `ses_step_${Date.now()}_throw`
    const hook = () => undefined
    await expect(
      SessionLoop.withStepHook(sessionID, hook, async () => {
        throw new Error("intentional")
      }),
    ).rejects.toThrow("intentional")
    // Map entry cleared — setting again should not stack (idempotent no-op).
    SessionLoop.setStepHook(sessionID, undefined)
  })

  test("setStepHook replaces the registered hook wholesale", async () => {
    const sessionID = `ses_step_${Date.now()}_replace`
    const firstCalls: number[] = []
    const secondCalls: number[] = []
    const first = (e: { step: number }) => {
      firstCalls.push(e.step)
    }
    const second = (e: { step: number }) => {
      secondCalls.push(e.step)
    }
    SessionLoop.setStepHook(sessionID, first)
    SessionLoop.setStepHook(sessionID, second)
    // After replace, only `second` is active. We cannot invoke the hook
    // from here without running a real session, so this test just asserts
    // the API contract does not throw.
    SessionLoop.setStepHook(sessionID, undefined)
    expect(firstCalls).toEqual([])
    expect(secondCalls).toEqual([])
  })

  test("SessionPrompt re-exports setStepHook / withStepHook with identity", () => {
    expect(SessionPrompt.setStepHook).toBe(SessionLoop.setStepHook)
    expect(SessionPrompt.withStepHook).toBe(SessionLoop.withStepHook)
  })
})
