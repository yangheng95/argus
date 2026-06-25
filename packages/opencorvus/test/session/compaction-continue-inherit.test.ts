import { describe, expect, test } from "bun:test"
import { tool } from "ai"
import z from "zod"
import { WorkerTurnDescriptor } from "../../src/agent/worker-turn-descriptor"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { AgentRuntimeMetadata } from "../../src/session/agent-runtime-metadata"
import { AutomaticCompaction } from "../../src/session/auto-compaction"
import { SessionCompaction } from "../../src/session/compaction"
import { SessionControl } from "../../src/session/control"
import { SessionLoop } from "../../src/session/loop"
import { SESSION_KINDS, type SessionKind } from "../../src/session/session.sql"
import { tmpdir } from "../fixture/fixture"

describe("SessionCompaction continuation", () => {
  const dummyTool = () =>
    tool({
      description: "test-only",
      inputSchema: z.object({}),
      async execute() {
        return "ok"
      },
    })

  function installRuntimeContinuation(input: { sessionID: string; kind: SessionKind }) {
    const descriptor = WorkerTurnDescriptor.create({
      sessionID: input.sessionID,
      payload: {
        agent: input.kind,
        roleContractID: input.kind,
        model: { providerID: "provider-a", modelID: "model-a" },
        prompt: { systemMode: "complete", rawSystemPrompt: false },
        tools: { enabled: ["persistent"] },
        output: { format: "text", resultMode: "reply" },
        workflow: {
          sessionKind: input.kind,
        },
      },
    })
    SessionLoop.setSessionRuntimeContract(input.sessionID, {
      identity: {
        sessionID: input.sessionID,
        agentKind: input.kind,
        contractKind: "stage-attempt",
        workerTurnDescriptorID: descriptor.id,
        workerTurnDescriptorHash: descriptor.hash,
        installedAt: Date.now(),
      },
      tools: { persistent: dummyTool() },
    })
    return descriptor
  }

  function installOrchestratorWake(input: { sessionID: string }) {
    SessionLoop.setSessionRuntimeContract(input.sessionID, {
      identity: {
        sessionID: input.sessionID,
        agentKind: "orchestrator",
        contractKind: "orchestrator-wake",
        installedAt: Date.now(),
      },
      tools: { build: dummyTool() },
      system: ["test scheduler wake"],
      systemMode: "complete",
      runOnce: true,
    })
  }

  test("does not expose a user-message continuation builder", () => {
    expect("buildContinueUserMessage" in SessionCompaction).toBe(false)
  })

  test("creates compaction request as a session control record without copying the user prompt contract", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "assistant", title: "compaction inheritance" })
        const source = await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "provider-a", modelID: "model-a" },
          format: {
            type: "json_schema",
            schema: {
              type: "object",
              properties: { status: { type: "string" } },
              required: ["status"],
            },
            retryCount: 1,
          },
          system: "stage system prompt",
          systemMode: "complete",
          tools: { edit: true, bash: false },
          variant: "xhigh",
          extra: { goalID: "gol_compaction_contract" },
        })
        expect(source.role).toBe("user")
        if (source.role !== "user") return

        await SessionCompaction.create({
          sessionID: session.id,
          source,
          auto: true,
          overflow: false,
        })

        const messages = await Session.messages({ sessionID: session.id })
        const compaction = messages.find((msg) => msg.parts.some((part) => part.type === "compaction"))
        expect(compaction).toBeUndefined()

        const controls = SessionControl.pending(session.id)
        expect(controls).toHaveLength(1)
        expect(controls[0].kind).toBe("compaction_request")
        expect(controls[0].payload).toEqual({
          source_user_message_id: source.id,
          model: undefined,
          overflow: false,
          focus: undefined,
        })
      },
    })
  })

  test("persists an explicit compaction model override on the control record only", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "assistant", title: "compaction model override" })
        const source = await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "provider-a", modelID: "model-a" },
        })
        expect(source.role).toBe("user")
        if (source.role !== "user") return

        await SessionCompaction.create({
          sessionID: session.id,
          source,
          model: { providerID: "provider-b", modelID: "model-b" },
          auto: false,
          overflow: false,
        })

        const messages = await Session.messages({ sessionID: session.id })
        const compaction = messages.find((msg) => msg.parts.some((part) => part.type === "compaction"))
        expect(compaction).toBeUndefined()

        const controls = SessionControl.pending(session.id)
        expect(controls).toHaveLength(1)
        expect(controls[0].kind).toBe("manual_summarize")
        expect(controls[0].payload.model).toEqual({ providerID: "provider-b", modelID: "model-b" })
      },
    })
  })

  test("automatic compaction metadata partitions every session kind explicitly", () => {
    const partitions = [
      ...AgentRuntimeMetadata.DIRECT_AUTOMATIC_COMPACTION_SESSION_KINDS,
      ...AgentRuntimeMetadata.LIVE_RUNTIME_CONTINUATION_SESSION_KINDS,
      ...AgentRuntimeMetadata.ORCHESTRATOR_WAKE_AUTOMATIC_COMPACTION_SESSION_KINDS,
      ...AgentRuntimeMetadata.DISABLED_AUTOMATIC_COMPACTION_SESSION_KINDS,
    ]
    const unique = new Set<SessionKind>(partitions)

    expect([...unique].sort()).toEqual([...SESSION_KINDS].sort())
    expect(unique.size).toBe(partitions.length)
    for (const kind of AgentRuntimeMetadata.AGENT_OWNED_SESSION_KINDS) {
      expect(unique.has(kind)).toBe(true)
    }
  })

  test("automatic compaction decision has an explicit outcome for every agent-owned kind", () => {
    for (const kind of AgentRuntimeMetadata.AGENT_OWNED_SESSION_KINDS) {
      const coldDecision = AutomaticCompaction.decision({ sessionKind: kind })
      if (AgentRuntimeMetadata.LIVE_RUNTIME_CONTINUATION_SESSION_KIND_SET.has(kind)) {
        expect(coldDecision).toEqual({ enabled: false, reason: "runtime_contract_required" })
        expect(AutomaticCompaction.decision({ sessionKind: kind, runtimeContinuationReady: true })).toEqual({
          enabled: true,
          reason: "runtime_continuation_ready",
        })
      } else if (AgentRuntimeMetadata.ORCHESTRATOR_WAKE_AUTOMATIC_COMPACTION_SESSION_KIND_SET.has(kind)) {
        expect(coldDecision).toEqual({ enabled: false, reason: "runtime_contract_required" })
        expect(AutomaticCompaction.decision({ sessionKind: kind, runtimeContinuationReady: true })).toEqual({
          enabled: true,
          reason: "orchestrator_wake_ready",
        })
      } else if (AgentRuntimeMetadata.DISABLED_AUTOMATIC_COMPACTION_SESSION_KIND_SET.has(kind)) {
        expect(coldDecision).toEqual({ enabled: false, reason: "unsupported_workflow_kind" })
      } else {
        expect(coldDecision).toEqual({ enabled: true, reason: "allowed" })
      }
    }
  })

  test("uncategorized session kinds do not silently enable automatic compaction", () => {
    expect(AutomaticCompaction.decision({ sessionKind: "future-agent-kind" })).toEqual({
      enabled: false,
      reason: "uncategorized_session_kind",
    })
  })

  test("queues automatic compaction for every directly allowed agent-owned kind", async () => {
    const directAgentKinds = AgentRuntimeMetadata.DIRECT_AUTOMATIC_COMPACTION_SESSION_KINDS.filter((kind) =>
      AgentRuntimeMetadata.AGENT_OWNED_SESSION_KIND_SET.has(kind),
    )
    expect(directAgentKinds).toEqual(["mission"])

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        for (const kind of directAgentKinds) {
          const session = await Session.create({ kind, title: `${kind} direct auto compaction` })
          const source = await Session.updateMessage({
            id: Identifier.ascending("message"),
            sessionID: session.id,
            role: "user",
            time: { created: Date.now() },
            agent: kind,
            model: { providerID: "provider-a", modelID: "model-a" },
          })
          expect(source.role).toBe("user")
          if (source.role !== "user") return

          await SessionCompaction.create({
            sessionID: session.id,
            source,
            auto: true,
            overflow: true,
          })

          const messages = await Session.messages({ sessionID: session.id })
          expect(messages.filter((message) => message.parts.some((part) => part.type === "compaction"))).toEqual([])

          const controls = SessionControl.pending(session.id)
          expect(controls).toHaveLength(1)
          expect(controls[0]).toMatchObject({
            kind: "compaction_request",
            payload: {
              source_user_message_id: source.id,
              overflow: true,
            },
          })
        }
      },
    })
  })

  test("rejects automatic compaction for every disabled agent-owned workflow kind", async () => {
    const disabledAgentKinds = AgentRuntimeMetadata.DISABLED_AUTOMATIC_COMPACTION_SESSION_KINDS.filter((kind) =>
      AgentRuntimeMetadata.AGENT_OWNED_SESSION_KIND_SET.has(kind),
    )
    expect(disabledAgentKinds).toEqual(["acceptance"])

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        for (const kind of disabledAgentKinds) {
          const session = await Session.create({ kind, title: `${kind} disabled auto compaction` })
          const source = await Session.updateMessage({
            id: Identifier.ascending("message"),
            sessionID: session.id,
            role: "user",
            time: { created: Date.now() },
            agent: kind,
            model: { providerID: "provider-a", modelID: "model-a" },
          })
          expect(source.role).toBe("user")
          if (source.role !== "user") return

          await expect(
            SessionCompaction.create({
              sessionID: session.id,
              source,
              auto: true,
              overflow: true,
            }),
          ).rejects.toThrow("reason=unsupported_workflow_kind")

          expect(SessionControl.pending(session.id)).toEqual([])
        }
      },
    })
  })

  test("queues automatic compaction for orchestrator sessions with live scheduler wake runtime", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "orchestrator", title: "scheduler auto compaction" })
        installOrchestratorWake({ sessionID: session.id })
        const source = await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() },
          agent: "orchestrator",
          model: { providerID: "provider-a", modelID: "model-a" },
        })
        expect(source.role).toBe("user")
        if (source.role !== "user") return

        const decision = SessionLoop.automaticCompactionDecision({ session, source })
        expect(decision).toEqual({ decision: { enabled: true, reason: "orchestrator_wake_ready" } })

        await SessionCompaction.create({
          sessionID: session.id,
          source,
          auto: true,
          overflow: true,
        })

        const controls = SessionControl.pending(session.id)
        expect(controls).toHaveLength(1)
        expect(controls[0]).toMatchObject({
          kind: "compaction_request",
          payload: {
            source_user_message_id: source.id,
            overflow: true,
          },
        })
        SessionLoop.clearSessionRuntimeContract(session.id)
      },
    })
  })

  for (const kind of AgentRuntimeMetadata.LIVE_RUNTIME_CONTINUATION_SESSION_KINDS) {
    test(`queues automatic compaction for ${kind} workflow sessions with live runtime continuation`, async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({ kind, title: `${kind} auto compaction` })
          const descriptor = installRuntimeContinuation({ sessionID: session.id, kind })
          const source = await Session.updateMessage({
            id: Identifier.ascending("message"),
            sessionID: session.id,
            role: "user",
            time: { created: Date.now() },
            agent: kind,
            model: { providerID: "provider-a", modelID: "model-a" },
            format: { type: "text" },
            system: "stage system prompt",
            systemMode: "complete",
            tools: { persistent: true, bash: false },
            variant: "xhigh",
            extra: {
              marker: "original-user-contract",
              workerTurnDescriptor: { id: descriptor.id, hash: descriptor.hash },
            },
          })
          expect(source.role).toBe("user")
          if (source.role !== "user") return

          await SessionCompaction.create({
            sessionID: session.id,
            source,
            auto: true,
            overflow: true,
          })

          const messages = await Session.messages({ sessionID: session.id })
          const users = messages.filter((message) => message.info.role === "user")
          expect(users.map((message) => message.info.id)).toEqual([source.id])
          expect(users[0].info).toMatchObject({
            agent: kind,
            model: { providerID: "provider-a", modelID: "model-a" },
            format: { type: "text" },
            systemMode: "complete",
            tools: { persistent: true, bash: false },
            variant: "xhigh",
            extra: {
              marker: "original-user-contract",
              workerTurnDescriptor: { id: descriptor.id, hash: descriptor.hash },
            },
          })

          const controls = SessionControl.pending(session.id)
          expect(controls).toHaveLength(1)
          expect(controls[0]).toMatchObject({
            kind: "compaction_request",
            payload: {
              source_user_message_id: source.id,
              overflow: true,
            },
          })
          expect(descriptor.payload.output.resultMode).toBe("reply")
          SessionLoop.clearSessionRuntimeContract(session.id)
        },
      })
    })

    test(`rejects queued automatic compaction for ${kind} workflow sessions without live runtime continuation`, async () => {
      await using tmp = await tmpdir()
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const session = await Session.create({ kind, title: `${kind} auto compaction` })
          const source = await Session.updateMessage({
            id: Identifier.ascending("message"),
            sessionID: session.id,
            role: "user",
            time: { created: Date.now() },
            agent: kind,
            model: { providerID: "provider-a", modelID: "model-a" },
          })
          expect(source.role).toBe("user")
          if (source.role !== "user") return

          await expect(
            SessionCompaction.create({
              sessionID: session.id,
              source,
              auto: true,
              overflow: true,
            }),
          ).rejects.toThrow(`Automatic compaction is disabled for workflow session kind ${kind}`)

          expect(SessionControl.pending(session.id)).toEqual([])
        },
      })
    })
  }

  test("automatic compaction decision validates the supplied source user contract", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "build", title: "source-bound auto compaction" })
        const descriptor = installRuntimeContinuation({ sessionID: session.id, kind: "build" })
        const source = await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "provider-a", modelID: "model-a" },
          extra: {
            workerTurnDescriptor: { id: descriptor.id, hash: descriptor.hash },
          },
        })
        const wrongSource = await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() },
          agent: "integrity",
          model: { providerID: "provider-a", modelID: "model-a" },
          extra: {
            workerTurnDescriptor: { id: descriptor.id, hash: descriptor.hash },
          },
        })
        expect(source.role).toBe("user")
        expect(wrongSource.role).toBe("user")
        if (source.role !== "user" || wrongSource.role !== "user") return

        expect(
          SessionLoop.automaticCompactionDecision({
            session,
            source,
          }).decision,
        ).toEqual({ enabled: true, reason: "runtime_continuation_ready" })
        const rejected = SessionLoop.automaticCompactionDecision({
          session,
          source: wrongSource,
        })
        expect(rejected.decision).toEqual({ enabled: false, reason: "runtime_contract_required" })
        expect(rejected.error).toBeInstanceOf(Error)
        expect((rejected.error as Error).message).toContain("agent mismatch")
        SessionLoop.clearSessionRuntimeContract(session.id)
      },
    })
  })

  test("automatic compaction requires the source user's worker descriptor reference", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "build", title: "source descriptor required" })
        installRuntimeContinuation({ sessionID: session.id, kind: "build" })
        const source = await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "provider-a", modelID: "model-a" },
        })
        expect(source.role).toBe("user")
        if (source.role !== "user") return

        const decision = SessionLoop.automaticCompactionDecision({ session, source })
        expect(decision.decision).toEqual({ enabled: false, reason: "runtime_contract_required" })
        expect(decision.error).toBeInstanceOf(Error)
        expect((decision.error as Error).message).toContain("missing workerTurnDescriptor id/hash")
        SessionLoop.clearSessionRuntimeContract(session.id)
      },
    })
  })

  test("automatic compaction rejects orchestrator-wake runtime contracts for stage workers", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "build", title: "orchestrator wake cannot compact build" })
        const descriptor = WorkerTurnDescriptor.create({
          sessionID: session.id,
          payload: {
            agent: "build",
            roleContractID: "build",
            model: { providerID: "provider-a", modelID: "model-a" },
            prompt: { systemMode: "complete", rawSystemPrompt: false },
            tools: { enabled: ["persistent"] },
            output: { format: "text", resultMode: "reply" },
            workflow: {
              sessionKind: "build",
            },
          },
        })
        SessionLoop.setSessionRuntimeContract(session.id, {
          identity: {
            sessionID: session.id,
            agentKind: "build",
            contractKind: "orchestrator-wake",
            workerTurnDescriptorID: descriptor.id,
            workerTurnDescriptorHash: descriptor.hash,
            installedAt: Date.now(),
          },
          tools: { persistent: dummyTool() },
        })
        const source = await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "provider-a", modelID: "model-a" },
          extra: {
            workerTurnDescriptor: { id: descriptor.id, hash: descriptor.hash },
          },
        })
        expect(source.role).toBe("user")
        if (source.role !== "user") return

        const decision = SessionLoop.automaticCompactionDecision({ session, source })
        expect(decision.decision).toEqual({ enabled: false, reason: "runtime_contract_required" })
        expect(decision.error).toBeInstanceOf(Error)
        expect((decision.error as Error).message).toContain("kind mismatch")
        SessionLoop.clearSessionRuntimeContract(session.id)
      },
    })
  })

  test("rejects scheduler automatic compaction without a live wake runtime", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "orchestrator", title: "scheduler cold auto compaction" })
        const source = await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() },
          agent: "orchestrator",
          model: { providerID: "provider-a", modelID: "model-a" },
        })
        expect(source.role).toBe("user")
        if (source.role !== "user") return

        const decision = SessionLoop.automaticCompactionDecision({ session, source })
        expect(decision.decision).toEqual({ enabled: false, reason: "runtime_contract_required" })
        expect(decision.error).toBeInstanceOf(Error)

        await expect(
          SessionCompaction.create({
            sessionID: session.id,
            source,
            auto: true,
            overflow: true,
          }),
        ).rejects.toThrow("reason=runtime_contract_required")
      },
    })
  })

  test("allows manual summarize for build sessions", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "build", title: "workflow manual summarize" })
        const source = await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() },
          agent: "build",
          model: { providerID: "provider-a", modelID: "model-a" },
        })
        expect(source.role).toBe("user")
        if (source.role !== "user") return

        await SessionCompaction.create({
          sessionID: session.id,
          source,
          auto: false,
          overflow: true,
        })

        const controls = SessionControl.pending(session.id)
        expect(controls).toHaveLength(1)
        expect(controls[0].kind).toBe("manual_summarize")
      },
    })
  })
})
