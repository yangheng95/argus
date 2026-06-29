import { describe, expect, test } from "bun:test"
import path from "path"
import { pathToFileURL } from "url"
import { ACP } from "../../src/acp/agent"
import type { AgentSideConnection } from "@agentclientprotocol/sdk"
import type { Event, EventMessagePartUpdated, ToolStatePending, ToolStateRunning } from "@opencorvus-ai/sdk"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { AttachmentStore } from "../../src/storage/attachment-store"

type SessionUpdateParams = Parameters<AgentSideConnection["sessionUpdate"]>[0]
type RequestPermissionParams = Parameters<AgentSideConnection["requestPermission"]>[0]
type RequestPermissionResult = Awaited<ReturnType<AgentSideConnection["requestPermission"]>>

type GlobalEventEnvelope = {
  directory?: string
  payload?: Event
}

const ACP_TEST_CONFIG = { model: "opencorvus/big-pickle" } as any

type EventController = {
  push: (event: GlobalEventEnvelope) => void
  close: () => void
}

function inProgressText(update: SessionUpdateParams["update"]) {
  if (update.sessionUpdate !== "tool_call_update") return undefined
  if (update.status !== "in_progress") return undefined
  if (!update.content || !Array.isArray(update.content)) return undefined
  const first = update.content[0]
  if (!first || first.type !== "content") return undefined
  if (first.content.type !== "text") return undefined
  return first.content.text
}

function isToolCallUpdate(
  update: SessionUpdateParams["update"],
): update is Extract<SessionUpdateParams["update"], { sessionUpdate: "tool_call_update" }> {
  return update.sessionUpdate === "tool_call_update"
}

function toolEvent(
  sessionId: string,
  cwd: string,
  opts: {
    callID: string
    tool: string
    input: Record<string, unknown>
  } & ({ status: "running"; metadata?: Record<string, unknown> } | { status: "pending"; raw: string }),
): GlobalEventEnvelope {
  const state: ToolStatePending | ToolStateRunning =
    opts.status === "running"
      ? {
          status: "running",
          input: opts.input,
          ...(opts.metadata && { metadata: opts.metadata }),
          time: { start: Date.now() },
        }
      : {
          status: "pending",
          input: opts.input,
          raw: opts.raw,
          time: { start: Date.now() },
        }
  const payload: EventMessagePartUpdated = {
    type: "message.part.updated",
    properties: {
      part: {
        id: `part_${opts.callID}`,
        sessionID: sessionId,
        messageID: `msg_${opts.callID}`,
        type: "tool",
        callID: opts.callID,
        tool: opts.tool,
        state,
      },
    },
  }
  return { directory: cwd, payload }
}

function completedToolEvent(
  sessionId: string,
  cwd: string,
  opts: {
    callID: string
    tool: string
    input: Record<string, unknown>
    output: string
    attachments?: Array<{ type: "file"; mime: string; filename?: string; url: string }>
  },
): GlobalEventEnvelope {
  const payload: EventMessagePartUpdated = {
    type: "message.part.updated",
    properties: {
      part: {
        id: `part_${opts.callID}`,
        sessionID: sessionId,
        messageID: `msg_${opts.callID}`,
        type: "tool",
        callID: opts.callID,
        tool: opts.tool,
        state: {
          status: "completed",
          input: opts.input,
          output: opts.output,
          title: opts.tool,
          metadata: {},
          time: { start: Date.now(), end: Date.now() },
          attachments: opts.attachments?.map((attachment, index) => ({
            id: `file_${opts.callID}_${index}`,
            sessionID: sessionId,
            messageID: `msg_${opts.callID}`,
            ...attachment,
          })),
        },
      },
    },
  }
  return { directory: cwd, payload }
}

function createEventStream() {
  const queue: GlobalEventEnvelope[] = []
  const waiters: Array<(value: GlobalEventEnvelope | undefined) => void> = []
  const state = { closed: false }

  const push = (event: GlobalEventEnvelope) => {
    const waiter = waiters.shift()
    if (waiter) {
      waiter(event)
      return
    }
    queue.push(event)
  }

  const close = () => {
    state.closed = true
    for (const waiter of waiters.splice(0)) {
      waiter(undefined)
    }
  }

  const stream = async function* (signal?: AbortSignal) {
    while (true) {
      if (signal?.aborted) return
      const next = queue.shift()
      if (next) {
        yield next
        continue
      }
      if (state.closed) return
      const value = await new Promise<GlobalEventEnvelope | undefined>((resolve) => {
        waiters.push(resolve)
        if (!signal) return
        signal.addEventListener("abort", () => resolve(undefined), { once: true })
      })
      if (!value) return
      yield value
    }
  }

  return { controller: { push, close } satisfies EventController, stream }
}

function createFakeAgent() {
  const updates = new Map<string, string[]>()
  const chunks = new Map<string, string>()
  const sessionUpdates: SessionUpdateParams[] = []
  const record = (sessionId: string, type: string) => {
    const list = updates.get(sessionId) ?? []
    list.push(type)
    updates.set(sessionId, list)
  }

  const connection = {
    async sessionUpdate(params: SessionUpdateParams) {
      sessionUpdates.push(params)
      const update = params.update
      const type = update?.sessionUpdate ?? "unknown"
      record(params.sessionId, type)
      if (update?.sessionUpdate === "agent_message_chunk") {
        const content = update.content
        if (content?.type !== "text") return
        if (typeof content.text !== "string") return
        chunks.set(params.sessionId, (chunks.get(params.sessionId) ?? "") + content.text)
      }
    },
    async requestPermission(_params: RequestPermissionParams): Promise<RequestPermissionResult> {
      return { outcome: { outcome: "selected", optionId: "once" } } as RequestPermissionResult
    },
  } as unknown as AgentSideConnection

  const { controller, stream } = createEventStream()
  const calls = {
    eventSubscribe: 0,
    sessionCreate: 0,
  }
  const promptRequests: any[] = []
  const sessionDeleteRequests: any[] = []

  const sdk = {
    global: {
      event: async (opts?: { signal?: AbortSignal }) => {
        calls.eventSubscribe++
        return { stream: stream(opts?.signal) }
      },
    },
    session: {
      create: async (_params?: any) => {
        calls.sessionCreate++
        return {
          data: {
            id: `ses_${calls.sessionCreate}`,
            time: { created: new Date().toISOString() },
          },
        }
      },
      fork: async () => {
        calls.sessionCreate++
        return {
          data: {
            id: `ses_${calls.sessionCreate}`,
            time: { created: new Date().toISOString() },
          },
        }
      },
      get: async (params?: any) => {
        return {
          data: {
            id: params?.sessionID ?? "ses_1",
            time: { created: new Date().toISOString() },
          },
        }
      },
      messages: async () => {
        return { data: [] }
      },
      delete: async (params?: any) => {
        sessionDeleteRequests.push(params)
        return { data: true }
      },
      prompt: async (params?: any) => {
        promptRequests.push(params)
        return { data: undefined }
      },
      message: async (params?: any) => {
        // Return a message with parts that can be looked up by partID
        return {
          data: {
            info: {
              role: "assistant",
            },
            parts: [
              {
                id: params?.messageID ? `${params.messageID}_part` : "part_1",
                type: "text",
                text: "",
              },
            ],
          },
        }
      },
    },
    permission: {
      respond: async () => {
        return { data: true }
      },
    },
    config: {
      providers: async () => {
        return {
          data: {
            providers: [
              {
                id: "opencorvus",
                name: "opencorvus",
                models: {
                  "big-pickle": { id: "big-pickle", name: "big-pickle" },
                },
              },
            ],
          },
        }
      },
    },
    app: {
      agents: async () => {
        return {
          data: [
            {
              name: "build",
              description: "build",
              mode: "agent",
            },
          ],
        }
      },
    },
    command: {
      list: async () => {
        return { data: [] }
      },
    },
    mcp: {
      add: async () => {
        return { data: true }
      },
    },
  } as any

  // R5.1 item 8: ACPConfig no longer carries a `defaultModel`; the ACP
  // default model resolves through resolveConfiguredModelRef only.
  const agent = new ACP.Agent(connection, {
    sdk,
  } as any)

  const stop = () => {
    controller.close()
    ;(agent as any).eventAbort.abort()
  }

  return {
    agent,
    controller,
    calls,
    updates,
    chunks,
    promptRequests,
    sessionUpdates,
    sessionDeleteRequests,
    stop,
    sdk,
    connection,
  }
}

async function waitForSessionUpdate(
  sessionUpdates: SessionUpdateParams[],
  predicate: (params: SessionUpdateParams) => boolean,
  label: string,
): Promise<SessionUpdateParams["update"]> {
  for (let i = 0; i < 100; i += 1) {
    const found = sessionUpdates.find(predicate)
    if (found) return found.update
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  const observed = sessionUpdates.map((params) => {
    const update = params.update as any
    return {
      sessionUpdate: update?.sessionUpdate,
      status: update?.status,
      toolCallId: update?.toolCallId,
    }
  })
  throw new Error(`timed out waiting for ACP session update: ${label}; observed=${JSON.stringify(observed)}`)
}

async function waitForEventSubscription(calls: { eventSubscribe: number }, label: string): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    if (calls.eventSubscribe > 0) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ACP event subscription: ${label}`)
}

describe("acp.agent event subscription", () => {
  test("newSession rejects when requested MCP server attachment reports failure", async () => {
    await using tmp = await tmpdir({ config: ACP_TEST_CONFIG })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, sdk, sessionDeleteRequests, stop } = createFakeAgent()
        let addCalls = 0
        sdk.mcp.add = async (input: { directory?: string; name?: string }) => {
          addCalls += 1
          expect(input.directory).toBe(tmp.path)
          expect(input.name).toBe("broken")
          return {
            data: {
              broken: {
                status: "failed",
                error: "spawn failed",
              },
            },
          }
        }

        try {
          await expect(
            agent.newSession({
              cwd: tmp.path,
              mcpServers: [{ name: "broken", command: "missing-command", args: [], env: [] }],
            } as any),
          ).rejects.toThrow("MCP server broken failed to attach with status failed: spawn failed")
          expect(addCalls).toBe(1)
          expect(sessionDeleteRequests).toEqual([{ sessionID: "ses_1", directory: tmp.path }])
          await expect(
            agent.prompt({
              sessionId: "ses_1",
              prompt: [{ type: "text", text: "must not prompt a failed session" }],
            } as any),
          ).rejects.toThrow()
        } finally {
          stop()
        }
      },
    })
  })

  test("loadSession restores the previous ACP manager state when initialization fails", async () => {
    await using tmp = await tmpdir({ config: ACP_TEST_CONFIG })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, sdk, promptRequests, sessionDeleteRequests, stop } = createFakeAgent()
        try {
          const sessionId = await agent.newSession({ cwd: tmp.path, mcpServers: [] } as any).then((x) => x.sessionId)
          sdk.config.providers = async () => {
            throw new Error("providers failed during loadSession")
          }

          await expect(agent.loadSession({ sessionId, cwd: tmp.path, mcpServers: [] } as any)).rejects.toThrow(
            "providers failed during loadSession",
          )
          expect(sessionDeleteRequests).toEqual([])

          await agent.prompt({
            sessionId,
            prompt: [{ type: "text", text: "previous manager state still works" }],
          } as any)
          expect(promptRequests).toHaveLength(1)
          expect(promptRequests[0].sessionID).toBe(sessionId)
        } finally {
          stop()
        }
      },
    })
  })

  test("newSession deletes the created persistent session when provider loading fails", async () => {
    await using tmp = await tmpdir({ config: ACP_TEST_CONFIG })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, sdk, sessionDeleteRequests, stop } = createFakeAgent()
        try {
          sdk.config.providers = async () => {
            throw new Error("providers failed after session create")
          }

          await expect(agent.newSession({ cwd: tmp.path, mcpServers: [] } as any)).rejects.toThrow(
            "providers failed after session create",
          )
          expect(sessionDeleteRequests).toEqual([{ sessionID: "ses_1", directory: tmp.path }])
          await expect(
            agent.prompt({
              sessionId: "ses_1",
              prompt: [{ type: "text", text: "failed new session must not remain" }],
            } as any),
          ).rejects.toThrow()
        } finally {
          stop()
        }
      },
    })
  })

  test("newSession reports cleanup failure together with initialization failure", async () => {
    await using tmp = await tmpdir({ config: ACP_TEST_CONFIG })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, sdk, stop } = createFakeAgent()
        try {
          sdk.mcp.add = async () => ({
            data: {
              broken: {
                status: "failed",
                error: "spawn failed",
              },
            },
          })
          sdk.session.delete = async () => {
            throw new Error("delete cleanup failed")
          }

          const rejection = agent.newSession({
            cwd: tmp.path,
            mcpServers: [{ name: "broken", command: "missing-command", args: [], env: [] }],
          } as any)
          await expect(rejection).rejects.toThrow("ACP session initialization cleanup failed for ses_1")
          try {
            await rejection
          } catch (error) {
            expect(error).toBeInstanceOf(AggregateError)
            const errors = (error as AggregateError).errors.map((item) =>
              item instanceof Error ? item.message : String(item),
            )
            expect(errors.some((message) => message.includes("MCP server broken failed"))).toBe(true)
            expect(errors).toContain("delete cleanup failed")
          }
        } finally {
          stop()
        }
      },
    })
  })

  test("loadSession without previous manager state unregisters failed ACP state without deleting persistent session", async () => {
    await using tmp = await tmpdir({ config: ACP_TEST_CONFIG })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, sdk, sessionDeleteRequests, stop } = createFakeAgent()
        try {
          sdk.config.providers = async () => {
            throw new Error("providers failed during first load")
          }

          await expect(agent.loadSession({ sessionId: "ses_existing", cwd: tmp.path, mcpServers: [] } as any))
            .rejects.toThrow("providers failed during first load")
          expect(sessionDeleteRequests).toEqual([])
          await expect(
            agent.prompt({
              sessionId: "ses_existing",
              prompt: [{ type: "text", text: "failed load must not register" }],
            } as any),
          ).rejects.toThrow()
        } finally {
          stop()
        }
      },
    })
  })

  test("forwards https prompt image URIs as SDK file parts", async () => {
    await using tmp = await tmpdir({ config: ACP_TEST_CONFIG })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, promptRequests, stop } = createFakeAgent()
        const sessionId = await agent.newSession({ cwd: tmp.path, mcpServers: [] } as any).then((x) => x.sessionId)

        await agent.prompt({
          sessionId,
          prompt: [
            { type: "text", text: "inspect this image" },
            {
              type: "image",
              uri: "https://example.test/reference.png",
              mimeType: "image/png",
            },
          ],
        } as any)

        expect(promptRequests).toHaveLength(1)
        expect(promptRequests[0].parts).toContainEqual({
          type: "file",
          url: "https://example.test/reference.png",
          filename: "image",
          mime: "image/png",
        })

        stop()
      },
    })
  })

  test("forwards file prompt image URIs as SDK file parts", async () => {
    await using tmp = await tmpdir({
      config: ACP_TEST_CONFIG,
      init: async (dir) => {
        await Bun.write(path.join(dir, "reference.png"), Buffer.from("png"))
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, promptRequests, stop } = createFakeAgent()
        const sessionId = await agent.newSession({ cwd: tmp.path, mcpServers: [] } as any).then((x) => x.sessionId)
        const imagePath = path.join(tmp.path, "reference.png")

        await agent.prompt({
          sessionId,
          prompt: [
            {
              type: "image",
              uri: pathToFileURL(imagePath).href,
              mimeType: "image/png",
            },
          ],
        } as any)

        expect(promptRequests).toHaveLength(1)
        expect(promptRequests[0].parts).toContainEqual({
          type: "file",
          url: pathToFileURL(imagePath).href,
          filename: "reference.png",
          mime: "image/png",
        })

        stop()
      },
    })
  })

  test("routes message.part.delta by the event sessionID (no cross-session pollution)", async () => {
    await using tmp = await tmpdir({ config: ACP_TEST_CONFIG })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, controller, updates, stop } = createFakeAgent()
        const cwd = tmp.path

        const sessionA = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)
        const sessionB = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)

        controller.push({
          directory: cwd,
          payload: {
            type: "message.part.delta",
            properties: {
              sessionID: sessionB,
              messageID: "msg_1",
              partID: "msg_1_part",
              field: "text",
              delta: "hello",
            },
          },
        } as any)

        await new Promise((r) => setTimeout(r, 10))

        expect((updates.get(sessionA) ?? []).includes("agent_message_chunk")).toBe(false)
        expect((updates.get(sessionB) ?? []).includes("agent_message_chunk")).toBe(true)

        stop()
      },
    })
  })

  test("keeps concurrent sessions isolated when message.part.delta events are interleaved", async () => {
    await using tmp = await tmpdir({ config: ACP_TEST_CONFIG })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, controller, chunks, stop } = createFakeAgent()
        const cwd = tmp.path

        const sessionA = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)
        const sessionB = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)

        const tokenA = ["ALPHA_", "111", "_X"]
        const tokenB = ["BETA_", "222", "_Y"]

        const push = (sessionId: string, messageID: string, delta: string) => {
          controller.push({
            directory: cwd,
            payload: {
              type: "message.part.delta",
              properties: {
                sessionID: sessionId,
                messageID,
                partID: `${messageID}_part`,
                field: "text",
                delta,
              },
            },
          } as any)
        }

        push(sessionA, "msg_a", tokenA[0])
        push(sessionB, "msg_b", tokenB[0])
        push(sessionA, "msg_a", tokenA[1])
        push(sessionB, "msg_b", tokenB[1])
        push(sessionA, "msg_a", tokenA[2])
        push(sessionB, "msg_b", tokenB[2])

        await new Promise((r) => setTimeout(r, 20))

        const a = chunks.get(sessionA) ?? ""
        const b = chunks.get(sessionB) ?? ""

        expect(a).toContain(tokenA.join(""))
        expect(b).toContain(tokenB.join(""))
        for (const part of tokenB) expect(a).not.toContain(part)
        for (const part of tokenA) expect(b).not.toContain(part)

        stop()
      },
    })
  })

  test("does not create additional event subscriptions on repeated loadSession()", async () => {
    await using tmp = await tmpdir({ config: ACP_TEST_CONFIG })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, calls, stop } = createFakeAgent()
        const cwd = tmp.path

        const sessionId = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)

        await agent.loadSession({ sessionId, cwd, mcpServers: [] } as any)
        await agent.loadSession({ sessionId, cwd, mcpServers: [] } as any)
        await agent.loadSession({ sessionId, cwd, mcpServers: [] } as any)
        await agent.loadSession({ sessionId, cwd, mcpServers: [] } as any)

        expect(calls.eventSubscribe).toBe(1)

        stop()
      },
    })
  })

  test("loadSession replays stored attachment file parts as ACP image content", async () => {
    await using tmp = await tmpdir({ config: ACP_TEST_CONFIG })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, sessionUpdates, sdk, stop } = createFakeAgent()
        try {
          const stored = await AttachmentStore.write(
            Instance.project.id,
            Buffer.from("stored-image-bytes"),
            "image/png",
            "replay.png",
          )
          sdk.session.messages = async () => ({
            data: [
              {
                info: {
                  id: "msg_replay_image",
                  role: "user",
                  sessionID: "ses_1",
                  time: { created: new Date().toISOString() },
                },
                parts: [
                  {
                    id: "part_replay_image",
                    messageID: "msg_replay_image",
                    sessionID: "ses_1",
                    type: "file",
                    mime: "image/png",
                    filename: "replay.png",
                    url: stored.url,
                  },
                ],
              },
            ],
          })

          await agent.loadSession({ sessionId: "ses_1", cwd: tmp.path, mcpServers: [] } as any)

          const imageUpdate = sessionUpdates.find((params) => {
            const update = params.update as any
            return update.sessionUpdate === "user_message_chunk" && update.content?.type === "image"
          })
          expect(imageUpdate).toBeTruthy()
          const content = (imageUpdate!.update as any).content
          expect(content.mimeType).toBe("image/png")
          expect(content.data).toBe(Buffer.from("stored-image-bytes").toString("base64"))
        } finally {
          stop()
        }
      },
    })
  })

  test("loadSession rejects when ACP image replay sessionUpdate fails", async () => {
    await using tmp = await tmpdir({ config: ACP_TEST_CONFIG })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, connection, sdk, stop } = createFakeAgent()
        try {
          const stored = await AttachmentStore.write(
            Instance.project.id,
            Buffer.from("stored-image-bytes"),
            "image/png",
            "replay.png",
          )
          sdk.session.messages = async () => ({
            data: [
              {
                info: {
                  id: "msg_replay_image_fail",
                  role: "user",
                  sessionID: "ses_replay_image_fail",
                  time: { created: new Date().toISOString() },
                },
                parts: [
                  {
                    id: "part_replay_image_fail",
                    messageID: "msg_replay_image_fail",
                    sessionID: "ses_replay_image_fail",
                    type: "file",
                    mime: "image/png",
                    filename: "replay.png",
                    url: stored.url,
                  },
                ],
              },
            ],
          })
          const originalSessionUpdate = connection.sessionUpdate.bind(connection)
          connection.sessionUpdate = async (params: SessionUpdateParams) => {
            const update = params.update as any
            if (update.sessionUpdate === "user_message_chunk" && update.content?.type === "image") {
              throw new Error("ACP image replay unavailable")
            }
            return originalSessionUpdate(params)
          }

          await expect(
            agent.loadSession({ sessionId: "ses_replay_image_fail", cwd: tmp.path, mcpServers: [] } as any),
          ).rejects.toThrow("ACP image replay unavailable")
        } finally {
          stop()
        }
      },
    })
  })

  test("loadSession rejects malformed data URL file parts instead of replaying empty content", async () => {
    await using tmp = await tmpdir({ config: ACP_TEST_CONFIG })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, sessionUpdates, sdk, stop } = createFakeAgent()
        try {
          sdk.session.messages = async () => ({
            data: [
              {
                info: {
                  id: "msg_malformed_data_url",
                  role: "user",
                  sessionID: "ses_malformed_data_url",
                  time: { created: new Date().toISOString() },
                },
                parts: [
                  {
                    id: "part_malformed_data_url",
                    messageID: "msg_malformed_data_url",
                    sessionID: "ses_malformed_data_url",
                    type: "file",
                    mime: "text/plain",
                    filename: "malformed.txt",
                    url: "data:text/plain,hello%20world",
                  },
                ],
              },
            ],
          })

          await expect(
            agent.loadSession({ sessionId: "ses_malformed_data_url", cwd: tmp.path, mcpServers: [] } as any),
          ).rejects.toThrow('expected data URL of form "data:<mime>;base64,<bytes>"')
          expect(
            sessionUpdates.some((params) => {
              const update = params.update as any
              return update.sessionUpdate === "user_message_chunk" && update.content?.type === "resource"
            }),
          ).toBe(false)
        } finally {
          stop()
        }
      },
    })
  })

  test("loadSession rejects when persisted history cannot be fetched", async () => {
    await using tmp = await tmpdir({ config: ACP_TEST_CONFIG })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, sdk, stop } = createFakeAgent()
        try {
          sdk.session.messages = async () => {
            throw new Error("history store unavailable")
          }

          await expect(agent.loadSession({ sessionId: "ses_history_fail", cwd: tmp.path, mcpServers: [] } as any))
            .rejects.toThrow("history store unavailable")
        } finally {
          stop()
        }
      },
    })
  })

  test("unstable_forkSession rejects when forked history cannot be fetched", async () => {
    await using tmp = await tmpdir({ config: ACP_TEST_CONFIG })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, sdk, sessionDeleteRequests, stop } = createFakeAgent()
        try {
          sdk.session.fork = async () => ({
            data: {
              id: "ses_forked",
              time: { created: new Date().toISOString() },
            },
          })
          sdk.session.messages = async () => {
            throw new Error("forked history unavailable")
          }

          await expect(agent.unstable_forkSession({ sessionId: "ses_source", cwd: tmp.path, mcpServers: [] } as any))
            .rejects.toThrow("forked history unavailable")
          expect(sessionDeleteRequests).toEqual([{ sessionID: "ses_forked", directory: tmp.path }])
          await expect(
            agent.prompt({
              sessionId: "ses_forked",
              prompt: [{ type: "text", text: "failed fork child must not remain" }],
            } as any),
          ).rejects.toThrow()
        } finally {
          stop()
        }
      },
    })
  })

  test("unstable_resumeSession restores previous ACP manager state when initialization fails", async () => {
    await using tmp = await tmpdir({ config: ACP_TEST_CONFIG })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, sdk, promptRequests, sessionDeleteRequests, stop } = createFakeAgent()
        try {
          const sessionId = await agent.newSession({ cwd: tmp.path, mcpServers: [] } as any).then((x) => x.sessionId)
          sdk.config.providers = async () => {
            throw new Error("providers failed during resume")
          }

          await expect(agent.unstable_resumeSession({ sessionId, cwd: tmp.path, mcpServers: [] } as any))
            .rejects.toThrow("providers failed during resume")
          expect(sessionDeleteRequests).toEqual([])

          await agent.prompt({
            sessionId,
            prompt: [{ type: "text", text: "previous resumed state still works" }],
          } as any)
          expect(promptRequests).toHaveLength(1)
          expect(promptRequests[0].sessionID).toBe(sessionId)
        } finally {
          stop()
        }
      },
    })
  })

  test("unstable_resumeSession without previous manager state unregisters failed ACP state", async () => {
    await using tmp = await tmpdir({ config: ACP_TEST_CONFIG })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, sdk, sessionDeleteRequests, stop } = createFakeAgent()
        try {
          sdk.config.providers = async () => {
            throw new Error("providers failed during first resume")
          }

          await expect(
            agent.unstable_resumeSession({ sessionId: "ses_existing_resume", cwd: tmp.path, mcpServers: [] } as any),
          ).rejects.toThrow("providers failed during first resume")
          expect(sessionDeleteRequests).toEqual([])
          await expect(
            agent.prompt({
              sessionId: "ses_existing_resume",
              prompt: [{ type: "text", text: "failed resume must not register" }],
            } as any),
          ).rejects.toThrow()
        } finally {
          stop()
        }
      },
    })
  })

  test("loadSession replays persisted HTTPS file parts as ACP resource links", async () => {
    await using tmp = await tmpdir({ config: ACP_TEST_CONFIG })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, sessionUpdates, sdk, stop } = createFakeAgent()
        try {
          sdk.session.messages = async () => ({
            data: [
              {
                info: {
                  id: "msg_remote_resource",
                  role: "user",
                  sessionID: "ses_1",
                  time: { created: new Date().toISOString() },
                },
                parts: [
                  {
                    id: "part_remote_resource",
                    messageID: "msg_remote_resource",
                    sessionID: "ses_1",
                    type: "file",
                    mime: "image/png",
                    filename: "remote.png",
                    url: "https://example.test/remote.png",
                  },
                ],
              },
            ],
          })

          await agent.loadSession({ sessionId: "ses_1", cwd: tmp.path, mcpServers: [] } as any)

          const resourceLink = sessionUpdates.find((params) => {
            const update = params.update as any
            return update.sessionUpdate === "user_message_chunk" && update.content?.type === "resource_link"
          })
          expect(resourceLink).toBeTruthy()
          expect((resourceLink!.update as any).content).toMatchObject({
            type: "resource_link",
            uri: "https://example.test/remote.png",
            name: "remote.png",
            mimeType: "image/png",
          })
        } finally {
          stop()
        }
      },
    })
  })

  test("permission.asked events are handled and replied", async () => {
    await using tmp = await tmpdir({ config: ACP_TEST_CONFIG })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const permissionReplies: string[] = []
        const { agent, controller, stop, sdk } = createFakeAgent()
        sdk.permission.reply = async (params: any) => {
          permissionReplies.push(params.requestID)
          return { data: true }
        }
        const cwd = tmp.path

        const sessionA = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)

        controller.push({
          directory: cwd,
          payload: {
            type: "permission.asked",
            properties: {
              id: "perm_1",
              sessionID: sessionA,
              permission: "bash",
              patterns: ["*"],
              metadata: {},
              always: [],
            },
          },
        } as any)

        await new Promise((r) => setTimeout(r, 20))

        expect(permissionReplies).toContain("perm_1")

        stop()
      },
    })
  })

  test("permission prompt on session A does not block message updates for session B", async () => {
    await using tmp = await tmpdir({ config: ACP_TEST_CONFIG })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const permissionReplies: string[] = []
        let resolvePermissionA: (() => void) | undefined
        const permissionABlocking = new Promise<void>((r) => {
          resolvePermissionA = r
        })

        const { agent, controller, chunks, stop, sdk, connection } = createFakeAgent()

        // Make permission request for session A block until we release it
        const originalRequestPermission = connection.requestPermission.bind(connection)
        let permissionCalls = 0
        connection.requestPermission = async (params: RequestPermissionParams) => {
          permissionCalls++
          if (params.sessionId.endsWith("1")) {
            await permissionABlocking
          }
          return originalRequestPermission(params)
        }

        sdk.permission.reply = async (params: any) => {
          permissionReplies.push(params.requestID)
          return { data: true }
        }

        const cwd = tmp.path

        const sessionA = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)
        const sessionB = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)

        // Push permission.asked for session A (will block)
        controller.push({
          directory: cwd,
          payload: {
            type: "permission.asked",
            properties: {
              id: "perm_a",
              sessionID: sessionA,
              permission: "bash",
              patterns: ["*"],
              metadata: {},
              always: [],
            },
          },
        } as any)

        // Give time for permission handling to start
        await new Promise((r) => setTimeout(r, 10))

        // Push message for session B while A's permission is pending
        controller.push({
          directory: cwd,
          payload: {
            type: "message.part.delta",
            properties: {
              sessionID: sessionB,
              messageID: "msg_b",
              partID: "msg_b_part",
              field: "text",
              delta: "session_b_message",
            },
          },
        } as any)

        // Wait for session B's message to be processed
        await new Promise((r) => setTimeout(r, 20))

        // Session B should have received message even though A's permission is still pending
        expect(chunks.get(sessionB) ?? "").toContain("session_b_message")
        expect(permissionReplies).not.toContain("perm_a")

        // Release session A's permission
        resolvePermissionA!()
        await new Promise((r) => setTimeout(r, 20))

        // Now session A's permission should be replied
        expect(permissionReplies).toContain("perm_a")

        stop()
      },
    })
  })

  test("streams running bash output snapshots and de-dupes identical snapshots", async () => {
    await using tmp = await tmpdir({ config: ACP_TEST_CONFIG })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, controller, sessionUpdates, stop } = createFakeAgent()
        const cwd = tmp.path
        const sessionId = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)
        const input = { command: "echo hello", description: "run command" }

        for (const output of ["a", "a", "ab"]) {
          controller.push(
            toolEvent(sessionId, cwd, {
              callID: "call_1",
              tool: "bash",
              status: "running",
              input,
              metadata: { output },
            }),
          )
        }
        await new Promise((r) => setTimeout(r, 20))

        const snapshots = sessionUpdates
          .filter((u) => u.sessionId === sessionId)
          .filter((u) => isToolCallUpdate(u.update))
          .map((u) => inProgressText(u.update))

        expect(snapshots).toEqual(["a", undefined, "ab"])
        stop()
      },
    })
  })

  test("emits completed tool image attachments as ACP image content", async () => {
    await using tmp = await tmpdir({ config: ACP_TEST_CONFIG })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, controller, calls, sessionUpdates, stop } = createFakeAgent()
        const cwd = tmp.path
        const sessionId = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)
        await waitForEventSubscription(calls, "completed tool image attachments")
        const image = await AttachmentStore.write(
          Instance.project.id,
          Buffer.from("side-by-side-png"),
          "image/png",
          "side-by-side.png",
        )

        controller.push(
          completedToolEvent(sessionId, cwd, {
            callID: "call_compare",
            tool: "browser_preview_compare_scroll_slices",
            input: { targetID: "art_previewtarget_1" },
            output: "comparison completed",
            attachments: [
              {
                type: "file",
                mime: image.mime,
                filename: image.filename,
                url: image.url,
              },
            ],
          }),
        )
        const completed = await waitForSessionUpdate(
          sessionUpdates,
          (params) =>
            params.sessionId === sessionId &&
            params.update.sessionUpdate === "tool_call_update" &&
            params.update.status === "completed" &&
            params.update.toolCallId === "call_compare",
          "completed call_compare tool image update",
        )
        expect(completed?.sessionUpdate).toBe("tool_call_update")
        expect(completed?.status).toBe("completed")
        const content = completed?.content ?? []
        expect(
          content.some(
            (item: any) =>
              item.type === "content" &&
              item.content?.type === "image" &&
              item.content.mimeType === "image/png" &&
              item.content.data === Buffer.from("side-by-side-png").toString("base64"),
          ),
        ).toBe(true)
        stop()
      },
    })
  })

  test("does not emit completed tool updates when local image attachment reads fail", async () => {
    await using tmp = await tmpdir({ config: ACP_TEST_CONFIG })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, controller, calls, sessionUpdates, stop } = createFakeAgent()
        const cwd = tmp.path
        const sessionId = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)
        await waitForEventSubscription(calls, "missing tool image attachments")
        const missingUrl = `/attachment/${Instance.project.id}/missing-image.png`

        controller.push(
          completedToolEvent(sessionId, cwd, {
            callID: "call_missing_image",
            tool: "browser_preview_compare_scroll_slices",
            input: { targetID: "art_previewtarget_missing" },
            output: "comparison completed",
            attachments: [
              {
                type: "file",
                mime: "image/png",
                filename: "missing-image.png",
                url: missingUrl,
              },
            ],
          }),
        )
        await new Promise((r) => setTimeout(r, 20))

        const completed = sessionUpdates
          .filter((u) => u.sessionId === sessionId)
          .map((u) => u.update)
          .find(
            (update) =>
              update.sessionUpdate === "tool_call_update" &&
              update.status === "completed" &&
              update.toolCallId === "call_missing_image",
          )
        expect(completed).toBeUndefined()
        stop()
      },
    })
  })

  test("does not emit completed tool updates when image attachment URL is unsupported", async () => {
    await using tmp = await tmpdir({ config: ACP_TEST_CONFIG })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, controller, calls, sessionUpdates, stop } = createFakeAgent()
        const cwd = tmp.path
        const sessionId = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)
        await waitForEventSubscription(calls, "unsupported tool image attachments")

        controller.push(
          completedToolEvent(sessionId, cwd, {
            callID: "call_remote_image",
            tool: "browser_preview_compare_scroll_slices",
            input: { targetID: "art_previewtarget_remote" },
            output: "comparison completed",
            attachments: [
              {
                type: "file",
                mime: "image/png",
                filename: "remote-image.png",
                url: "https://example.test/remote-image.png",
              },
            ],
          }),
        )
        await new Promise((r) => setTimeout(r, 20))

        const completed = sessionUpdates
          .filter((u) => u.sessionId === sessionId)
          .map((u) => u.update)
          .find(
            (update) =>
              update.sessionUpdate === "tool_call_update" &&
              update.status === "completed" &&
              update.toolCallId === "call_remote_image",
          )
        expect(completed).toBeUndefined()
        stop()
      },
    })
  })

  test("emits synthetic pending before first running update for any tool", async () => {
    await using tmp = await tmpdir({ config: ACP_TEST_CONFIG })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, controller, sessionUpdates, stop } = createFakeAgent()
        const cwd = tmp.path
        const sessionId = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)

        controller.push(
          toolEvent(sessionId, cwd, {
            callID: "call_bash",
            tool: "bash",
            status: "running",
            input: { command: "echo hi", description: "run command" },
            metadata: { output: "hi\n" },
          }),
        )
        controller.push(
          toolEvent(sessionId, cwd, {
            callID: "call_read",
            tool: "read",
            status: "running",
            input: { filePath: "/tmp/example.txt" },
          }),
        )
        await new Promise((r) => setTimeout(r, 20))

        const types = sessionUpdates
          .filter((u) => u.sessionId === sessionId)
          .map((u) => u.update.sessionUpdate)
          .filter((u) => u === "tool_call" || u === "tool_call_update")
        expect(types).toEqual(["tool_call", "tool_call_update", "tool_call", "tool_call_update"])

        const pendings = sessionUpdates.filter(
          (u) => u.sessionId === sessionId && u.update.sessionUpdate === "tool_call",
        )
        expect(pendings.every((p) => p.update.sessionUpdate === "tool_call" && p.update.status === "pending")).toBe(
          true,
        )
        stop()
      },
    })
  })

  test("does not emit duplicate synthetic pending after replayed running tool", async () => {
    await using tmp = await tmpdir({ config: ACP_TEST_CONFIG })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, controller, sessionUpdates, stop, sdk } = createFakeAgent()
        const cwd = tmp.path
        const sessionId = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)
        const input = { command: "echo hi", description: "run command" }

        sdk.session.messages = async () => ({
          data: [
            {
              info: {
                role: "assistant",
                sessionID: sessionId,
              },
              parts: [
                {
                  type: "tool",
                  callID: "call_1",
                  tool: "bash",
                  state: {
                    status: "running",
                    input,
                    metadata: { output: "hi\n" },
                    time: { start: Date.now() },
                  },
                },
              ],
            },
          ],
        })

        await agent.loadSession({ sessionId, cwd, mcpServers: [] } as any)
        controller.push(
          toolEvent(sessionId, cwd, {
            callID: "call_1",
            tool: "bash",
            status: "running",
            input,
            metadata: { output: "hi\nthere\n" },
          }),
        )
        await new Promise((r) => setTimeout(r, 20))

        const types = sessionUpdates
          .filter((u) => u.sessionId === sessionId)
          .map((u) => u.update)
          .filter((u) => "toolCallId" in u && u.toolCallId === "call_1")
          .map((u) => u.sessionUpdate)
          .filter((u) => u === "tool_call" || u === "tool_call_update")

        expect(types).toEqual(["tool_call", "tool_call_update", "tool_call_update"])
        stop()
      },
    })
  })

  test("clears bash snapshot marker on pending state", async () => {
    await using tmp = await tmpdir({ config: ACP_TEST_CONFIG })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { agent, controller, sessionUpdates, stop } = createFakeAgent()
        const cwd = tmp.path
        const sessionId = await agent.newSession({ cwd, mcpServers: [] } as any).then((x) => x.sessionId)
        const input = { command: "echo hello", description: "run command" }

        controller.push(
          toolEvent(sessionId, cwd, {
            callID: "call_1",
            tool: "bash",
            status: "running",
            input,
            metadata: { output: "a" },
          }),
        )
        controller.push(
          toolEvent(sessionId, cwd, {
            callID: "call_1",
            tool: "bash",
            status: "pending",
            input,
            raw: '{"command":"echo hello"}',
          }),
        )
        controller.push(
          toolEvent(sessionId, cwd, {
            callID: "call_1",
            tool: "bash",
            status: "running",
            input,
            metadata: { output: "a" },
          }),
        )
        await new Promise((r) => setTimeout(r, 20))

        const snapshots = sessionUpdates
          .filter((u) => u.sessionId === sessionId)
          .filter((u) => isToolCallUpdate(u.update))
          .map((u) => inProgressText(u.update))

        expect(snapshots).toEqual(["a", "a"])
        stop()
      },
    })
  })
})
