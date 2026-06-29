import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import {
  createAgentCoordinationRequest,
  findAgentCoordinationRequest,
  listAgentCoordinationActions,
  listPendingAgentCoordinationRequests,
} from "../../src/engine/agent-coordination"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { Identifier } from "../../src/id/id"
import { ProtocolEventTable } from "../../src/protocol/protocol.sql"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { Message } from "../../src/session/message"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionStatus } from "../../src/session/status"
import { AttachmentStore } from "../../src/storage/attachment-store"
import { Database, and, eq } from "../../src/storage/db"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("task agent session reply fails loudly when direct continuation is unavailable", () => {
  afterEach(async () => {
    mock.restore()
    await Instance.disposeAll()
    await resetDatabase()
  })

  async function seedTask(input: { taskID: string; rootID: string; now: number }) {
    await Session.updateMessage({
      id: Identifier.ascending("message"),
      sessionID: input.rootID,
      role: "user",
      time: { created: input.now - 1 },
      agent: "orchestrator",
      model: { providerID: "overlay", modelID: "default" },
    })
    Database.use((db) =>
      db
        .insert(EngineTaskTable)
        .values({
          id: input.taskID,
          project_id: Instance.project.id,
          session_id: input.rootID,
          source: "panel",
          title: "reply routing",
          request: "reply routing",
          priority: "normal",
          time_created: input.now,
          time_updated: input.now,
          time_started: input.now,
        })
        .run(),
    )
  }

  async function postReply(input: {
    taskID: string
    sessionID: string
    directory: string
    message?: string
    attachments?: Array<{ mime: string; url: string; filename?: string }>
  }) {
    return Server.App().request(`/task/${input.taskID}/session/${input.sessionID}/reply`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-opencorvus-directory": input.directory,
      },
      body: JSON.stringify({ message: input.message ?? "continue here", attachments: input.attachments ?? [] }),
    })
  }

  async function expectNoTaskRootWake(input: { rootID: string }) {
    const messages = await Session.messages({ sessionID: input.rootID })
    const directReplyFallbackMessages = messages
      .map((message) => message.info)
      .filter(
        (info) =>
          info.role === "user" &&
          (info.extra as { operator_message?: { source?: string } } | undefined)?.operator_message?.source ===
            "overlay_agent_session_reply",
      )
    expect(directReplyFallbackMessages).toEqual([])
  }

  async function waitForLoopFailureProjection(input: { taskID: string; sessionID: string }) {
    const deadline = Date.now() + 5_000
    while (Date.now() <= deadline) {
      const status = SessionStatus.get(input.sessionID)
      const event = Database.use((db) =>
        db
          .select()
          .from(ProtocolEventTable)
          .where(
            and(
              eq(ProtocolEventTable.task_id, input.taskID),
              eq(ProtocolEventTable.session_id, input.sessionID),
              eq(ProtocolEventTable.type, "session.status"),
            ),
          )
          .get(),
      )
      if (status.type === "terminal" && status.reason === "error" && event) return { status, event }
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    throw new Error(`Timed out waiting for direct reply loop failure projection for ${input.sessionID}`)
  }

  test("kind not in direct-reply set rejects without task-root fallback", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "test-provider/test-model" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        const root = await Session.create({ kind: "root", title: "root" })
        const executor = await Session.create({ kind: "executor", parentID: root.id, title: "executor" })
        await seedTask({ taskID, rootID: root.id, now })

        const response = await postReply({ taskID, sessionID: executor.id, directory: tmp.path })

        expect(response.status).toBe(400)
        const body = (await response.json()) as { name?: string; data?: { kind?: string; sessionID?: string } }
        expect(body.name).toBe("InvalidReplyTargetKindError")
        expect(body.data?.kind).toBe("executor")
        expect(body.data?.sessionID).toBe(executor.id)
        await expectNoTaskRootWake({ rootID: root.id })
      },
    })
  })

  test("invalid direct reply with attachments rejects without task-root fallback", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        const root = await Session.create({ kind: "root", title: "root" })
        const executor = await Session.create({
          kind: "executor",
          parentID: root.id,
          title: "executor",
        })

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "panel",
              title: "attachment fallback reject",
              request: "attachment fallback reject",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run(),
        )

        const response = await app.request(`/task/${taskID}/session/${executor.id}/reply`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            message: "keep the file structured",
            attachments: [
              {
                mime: "text/plain",
                url: "https://example.test/spec.txt",
                filename: "spec.txt",
              },
            ],
          }),
        })

        expect(response.status).toBe(400)
        const body = (await response.json()) as { name?: string; data?: { kind?: string; sessionID?: string } }
        expect(body.name).toBe("InvalidReplyTargetKindError")
        expect(body.data?.kind).toBe("executor")
        expect(body.data?.sessionID).toBe(executor.id)
        expect(await Session.messages({ sessionID: root.id })).toEqual([])
        expect(await Session.messages({ sessionID: executor.id })).toEqual([])
      },
    })
  })

  test("accepted direct reply rejects dangling attachment references before persistence", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        const root = await Session.create({ kind: "root", title: "root" })
        const assistant = await Session.create({ kind: "assistant", parentID: root.id, title: "assistant" })
        await seedTask({ taskID, rootID: root.id, now })
        await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: assistant.id,
          role: "user",
          time: { created: now + 1 },
          agent: "assistant",
          model: { providerID: "test", modelID: "model" },
        })

        const response = await Server.App().request(`/task/${taskID}/session/${assistant.id}/reply`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            message: "use this file",
            attachments: [{ mime: "text/plain", url: "https://example.test/spec.txt", filename: "spec.txt" }],
          }),
        })

        expect(response.status).toBe(400)
        const body = (await response.json()) as { name?: string; data?: { reason?: string; url?: string } }
        expect(body.name).toBe("AgentSessionAttachmentReferenceError")
        expect(body.data?.reason).toBe("invalid_url")
        expect(body.data?.url).toBe("https://example.test/spec.txt")
        const messages = await Session.messages({ sessionID: assistant.id })
        expect(messages).toHaveLength(1)
      },
    })
  })

  test("accepted direct reply rejects stored attachment metadata drift before persistence", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        const root = await Session.create({ kind: "root", title: "root" })
        const assistant = await Session.create({ kind: "assistant", parentID: root.id, title: "assistant" })
        await seedTask({ taskID, rootID: root.id, now })
        await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: assistant.id,
          role: "user",
          time: { created: now + 1 },
          agent: "assistant",
          model: { providerID: "test", modelID: "model" },
        })
        const ref = await AttachmentStore.write(
          Instance.project.id,
          Buffer.from([0x89, 0x50, 0x4e, 0x47]),
          "image/png",
          "design.png",
        )

        const response = await Server.App().request(`/task/${taskID}/session/${assistant.id}/reply`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            message: "use this file",
            attachments: [{ mime: "text/plain", url: ref.url, filename: "spec.txt" }],
          }),
        })

        expect(response.status).toBe(400)
        const body = (await response.json()) as { name?: string; data?: { reason?: string; url?: string } }
        expect(body.name).toBe("AgentSessionAttachmentReferenceError")
        expect(body.data?.reason).toBe("metadata_mismatch")
        expect(body.data?.url).toBe(ref.url)
        const messages = await Session.messages({ sessionID: assistant.id })
        expect(messages).toHaveLength(1)
      },
    })
  })

  test("direct reply cannot target a task from another active project", async () => {
    await using projectA = await tmpdir({ git: true })
    await using projectB = await tmpdir({ git: true })
    let taskID = ""
    let rootID = ""
    let assistantID = ""

    await Instance.provide({
      directory: projectA.path,
      fn: async () => {
        taskID = Identifier.ascending("task")
        const now = Date.now()
        const root = await Session.create({ kind: "root", title: "root" })
        const assistant = await Session.create({ kind: "assistant", parentID: root.id, title: "assistant" })
        rootID = root.id
        assistantID = assistant.id
        await seedTask({ taskID, rootID, now })
      },
    })

    const response = await postReply({ taskID, sessionID: assistantID, directory: projectB.path })

    expect(response.status).toBe(404)
    await Instance.provide({
      directory: projectA.path,
      fn: async () => {
        await expectNoTaskRootWake({ rootID })
        expect(await Session.messages({ sessionID: assistantID })).toEqual([])
      },
    })
  })

  test("build sessions reject without task-root fallback", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "test-provider/test-model" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        const root = await Session.create({ kind: "root", title: "root" })
        const build = await Session.create({ kind: "build", parentID: root.id, title: "build" })
        await seedTask({ taskID, rootID: root.id, now })

        const response = await postReply({ taskID, sessionID: build.id, directory: tmp.path })

        expect(response.status).toBe(400)
        const body = (await response.json()) as { name?: string; data?: { kind?: string; sessionID?: string } }
        expect(body.name).toBe("InvalidReplyTargetKindError")
        expect(body.data?.kind).toBe("build")
        expect(body.data?.sessionID).toBe(build.id)
        await expectNoTaskRootWake({ rootID: root.id })
      },
    })
  })

  test("direct reply rejects envelopes tagged with non-direct-reply agents", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "test-provider/test-model" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        const root = await Session.create({ kind: "root", title: "root" })
        const requirements = await Session.create({ kind: "requirements", parentID: root.id, title: "requirements" })
        await seedTask({ taskID, rootID: root.id, now })
        await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: requirements.id,
          role: "user",
          time: { created: now + 1 },
          agent: "build",
          model: { providerID: "test-provider", modelID: "test-model" },
        })

        const response = await postReply({ taskID, sessionID: requirements.id, directory: tmp.path })

        expect(response.status).toBe(400)
        const body = (await response.json()) as {
          name?: string
          data?: { sessionID?: string; sessionKind?: string; envelopeAgent?: string; reason?: string }
        }
        expect(body.name).toBe("AgentDirectReplyDisabledError")
        expect(body.data).toMatchObject({
          sessionID: requirements.id,
          sessionKind: "requirements",
          envelopeAgent: "build",
          reason: "envelope_agent_not_direct_replyable",
        })
        const userMessages = (await Session.messages({ sessionID: requirements.id })).filter(
          (message) => message.info.role === "user",
        )
        expect(userMessages).toHaveLength(1)
        await expectNoTaskRootWake({ rootID: root.id })
      },
    })
  })

  test("sessions without a prior envelope reject without task-root fallback", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "test-provider/test-model" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        const root = await Session.create({ kind: "root", title: "root" })
        const evaluator = await Session.create({ kind: "evaluator", parentID: root.id, title: "evaluator" })
        await seedTask({ taskID, rootID: root.id, now })

        const response = await postReply({ taskID, sessionID: evaluator.id, directory: tmp.path })

        expect(response.status).toBe(409)
        const body = (await response.json()) as { name?: string; data?: { sessionID?: string } }
        expect(body.name).toBe("ReplyTargetEnvelopeMissingError")
        expect(body.data?.sessionID).toBe(evaluator.id)
        await expectNoTaskRootWake({ rootID: root.id })
      },
    })
  })

  test("sessions with missing runtime contract reject without task-root fallback", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "test-provider/test-model" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        const root = await Session.create({ kind: "root", title: "root" })
        const architect = await Session.create({ kind: "architect", parentID: root.id, title: "architect" })
        await seedTask({ taskID, rootID: root.id, now })
        await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: architect.id,
          role: "user",
          time: { created: now + 1 },
          agent: "architect",
          model: { providerID: "test-provider", modelID: "test-model" },
        })

        const response = await postReply({ taskID, sessionID: architect.id, directory: tmp.path })

        expect(response.status).toBe(410)
        const body = (await response.json()) as { name?: string; data?: { sessionID?: string } }
        expect(body.name).toBe("SessionRuntimeContractMissingError")
        expect(body.data?.sessionID).toBe(architect.id)
        await expectNoTaskRootWake({ rootID: root.id })
      },
    })
  })

  test("pending A2A request rejects direct reply without consuming the coordination request", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "test-provider/test-model" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        const root = await Session.create({ kind: "root", title: "root" })
        const architect = await Session.create({ kind: "architect", parentID: root.id, title: "architect" })
        await seedTask({ taskID, rootID: root.id, now })
        await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: architect.id,
          role: "user",
          time: { created: now + 1 },
          agent: "architect",
          model: { providerID: "test-provider", modelID: "test-model" },
        })
        const request = await createAgentCoordinationRequest({
          taskID,
          sessionID: architect.id,
          agent: "architect",
          messageID: "msg_direct_reply_pending_a2a",
          callID: "cal_direct_reply_pending_a2a",
          summary: "Architect asks for scheduler guidance",
          details: "The architect worker needs the orchestrator to choose the next lifecycle action.",
          blocking: true,
          requestedDecision: "continue",
          now: now + 2,
        })

        const response = await postReply({ taskID, sessionID: architect.id, directory: tmp.path })

        expect(response.status).toBe(409)
        const body = (await response.json()) as {
          name?: string
          data?: { sessionID?: string; requestIDs?: string[] }
        }
        expect(body.name).toBe("AgentSessionPendingCoordinationError")
        expect(body.data?.sessionID).toBe(architect.id)
        expect(body.data?.requestIDs).toEqual([request.payload.request_id])
        expect(findAgentCoordinationRequest({ taskID, requestID: request.payload.request_id })?.payload.status).toBe(
          "pending",
        )
        expect(listPendingAgentCoordinationRequests(taskID).map((row) => row.payload.request_id)).toEqual([
          request.payload.request_id,
        ])
        expect(listAgentCoordinationActions(taskID)).toEqual([])
        const architectUserMessages = (await Session.messages({ sessionID: architect.id })).filter(
          (message) => message.info.role === "user",
        )
        expect(architectUserMessages).toHaveLength(1)
        await expectNoTaskRootWake({ rootID: root.id })
      },
    })
  })

  test("healthy direct sessions still append directly to that session", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "test-provider/test-model" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        const root = await Session.create({ kind: "root", title: "root" })
        await Session.mergeConfigOverlay({
          sessionID: root.id,
          patch: {
            model: "overlay/default",
            agent: { architect: { model: "overlay/architect" } },
          },
        })
        const assistant = await Session.create({ kind: "assistant", parentID: root.id, title: "assistant" })
        await seedTask({ taskID, rootID: root.id, now })
        await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: assistant.id,
          role: "user",
          time: { created: now + 1 },
          agent: "assistant",
          model: { providerID: "overlay", modelID: "default" },
        })

        const ref = await AttachmentStore.write(
          Instance.project.id,
          Buffer.from([0x89, 0x50, 0x4e, 0x47]),
          "image/png",
          "design.png",
        )

        const response = await postReply({
          taskID,
          sessionID: assistant.id,
          directory: tmp.path,
          attachments: [{ mime: ref.mime, url: ref.url, filename: ref.filename }],
        })

        expect(response.status).toBe(202)
        const directMessages = await Session.messages({ sessionID: assistant.id })
        const userMessages = directMessages.filter((message) => message.info.role === "user")
        expect(userMessages).toHaveLength(2)
        const filePart = userMessages.at(-1)?.parts.find((part: any) => part.type === "file") as
          | { mime?: string; filename?: string; url?: string }
          | undefined
        expect(filePart).toMatchObject({
          mime: "image/png",
          filename: "design.png",
          url: ref.url,
        })
      },
    })
  })

  test("accepted direct reply surfaces loop startup failure without task-root fallback", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "test-provider/test-model" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        spyOn(SessionPrompt, "loop").mockRejectedValue(new Error("direct reply loop exploded"))
        const taskID = Identifier.ascending("task")
        const now = Date.now()
        const root = await Session.create({ kind: "root", title: "root" })
        const assistant = await Session.create({ kind: "assistant", parentID: root.id, title: "assistant" })
        await seedTask({ taskID, rootID: root.id, now })
        await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: assistant.id,
          role: "user",
          time: { created: now + 1 },
          agent: "assistant",
          model: { providerID: "test-provider", modelID: "test-model" },
        })

        const response = await postReply({ taskID, sessionID: assistant.id, directory: tmp.path })

        expect(response.status).toBe(202)
        const body = (await response.json()) as { message_id?: string; session_id?: string; task_id?: string }
        expect(body).toMatchObject({ task_id: taskID, session_id: assistant.id })
        expect(await Message.get({ sessionID: assistant.id, messageID: body.message_id! })).toBeDefined()
        const projection = await waitForLoopFailureProjection({ taskID, sessionID: assistant.id })
        expect(projection.status).toEqual({
          type: "terminal",
          reason: "error",
          error: "direct reply loop exploded",
        })
        expect(projection.event.payload).toMatchObject({
          sessionID: assistant.id,
          status: {
            type: "terminal",
            reason: "error",
            error: "direct reply loop exploded",
          },
        })
        await expectNoTaskRootWake({ rootID: root.id })
      },
    })
  })
})
