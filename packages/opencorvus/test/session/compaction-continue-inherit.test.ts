import { describe, expect, test } from "bun:test"
import { tool } from "ai"
import z from "zod"
import { WorkerTurnDescriptor } from "../../src/agent/worker-turn-descriptor"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionCompaction } from "../../src/session/compaction"
import { SessionControl } from "../../src/session/control"
import { SessionLoop } from "../../src/session/loop"
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

  function installRuntimeContinuation(input: {
    sessionID: string
    kind: "build" | "frontend-design" | "integrity" | "visual-qa"
  }) {
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

  for (const kind of ["build", "frontend-design", "integrity", "visual-qa"] as const) {
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

  test("still rejects unsupported workflow automatic compaction", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "orchestrator", title: "unsupported auto compaction" })
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

        await expect(
          SessionCompaction.create({
            sessionID: session.id,
            source,
            auto: true,
            overflow: true,
          }),
        ).rejects.toThrow("reason=unsupported_workflow_kind")
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
