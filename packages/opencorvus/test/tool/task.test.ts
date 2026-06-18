import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test"
import { assertTaskResumeSession, sessionKindForSubagent, taskToolSessionMetadata, TaskTool } from "../../src/tool/task"
import type { Session } from "../../src/session"
import { Config } from "../../src/config/config"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { Message } from "../../src/session/message"
import { Session as SessionAPI } from "../../src/session"
import { SessionCompaction } from "../../src/session/compaction"
import { SessionControl } from "../../src/session/control"
import { SessionPrompt } from "../../src/session/prompt"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

beforeEach(async () => {
  await resetDatabase()
})

afterEach(async () => {
  mock.restore()
  Config.global.reset()
  await Instance.disposeAll()
})

test("task tool creates explore subagents in the explore session lane", () => {
  expect(sessionKindForSubagent("explore")).toBe("explore")
  expect(sessionKindForSubagent("general")).toBe("assistant")
})

function session(input: Partial<Session.Info> & Pick<Session.Info, "id">): Session.Info {
  return {
    id: input.id,
    slug: input.slug ?? input.id,
    projectID: input.projectID ?? "project_test",
    directory: input.directory ?? "/workspace",
    parentID: input.parentID,
    title: input.title ?? input.id,
    version: input.version ?? "test",
    kind: input.kind ?? "assistant",
    metadata: input.metadata,
    time: input.time ?? {
      created: 1,
      updated: 1,
    },
  } as Session.Info
}

test("task_id resume accepts only the original child subagent session", () => {
  const callerSession = session({ id: "ses_parent", directory: "/workspace", kind: "orchestrator" })
  const resumeSession = session({
    id: "ses_child",
    parentID: callerSession.id,
    directory: callerSession.directory,
    kind: "assistant",
    metadata: taskToolSessionMetadata("general"),
  })

  expect(() =>
    assertTaskResumeSession({
      resumeSession,
      callerSession,
      expectedKind: "assistant",
      expectedSubagent: "general",
    }),
  ).not.toThrow()
})

test("task_id resume rejects sessions outside the caller boundary", () => {
  const callerSession = session({ id: "ses_parent", directory: "/workspace", kind: "orchestrator" })
  const legal = session({
    id: "ses_child",
    parentID: callerSession.id,
    directory: callerSession.directory,
    kind: "assistant",
    metadata: taskToolSessionMetadata("general"),
  })

  expect(() =>
    assertTaskResumeSession({
      resumeSession: session({ ...legal, parentID: "ses_other_parent" }),
      callerSession,
      expectedKind: "assistant",
      expectedSubagent: "general",
    }),
  ).toThrow("not a child session")

  expect(() =>
    assertTaskResumeSession({
      resumeSession: session({ ...legal, kind: "explore" }),
      callerSession,
      expectedKind: "assistant",
      expectedSubagent: "general",
    }),
  ).toThrow("expected assistant")

  expect(() =>
    assertTaskResumeSession({
      resumeSession: session({ ...legal, directory: "/other-workspace" }),
      callerSession,
      expectedKind: "assistant",
      expectedSubagent: "general",
    }),
  ).toThrow("belongs to /other-workspace")

  expect(() =>
    assertTaskResumeSession({
      resumeSession: session({ ...legal, metadata: taskToolSessionMetadata("explore") }),
      callerSession,
      expectedKind: "assistant",
      expectedSubagent: "general",
    }),
  ).toThrow("belongs to subagent explore")

  expect(() =>
    assertTaskResumeSession({
      resumeSession: session({ ...legal, metadata: undefined }),
      callerSession,
      expectedKind: "assistant",
      expectedSubagent: "general",
    }),
  ).toThrow("belongs to subagent undefined")
})

function assistantMessageInput(sessionID: string): Message.Assistant {
  return {
    id: Identifier.ascending("message"),
    sessionID,
    parentID: Identifier.ascending("message"),
    role: "assistant",
    mode: "test",
    agent: "general",
    path: { cwd: "/", root: "/" },
    cost: 0,
    tokens: {
      total: 0,
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    modelID: "model",
    providerID: "test",
    time: { created: Date.now() },
  }
}

test("task tool explore dispatch installs live runtime contract for fresh and resumed child sessions", async () => {
  await using tmp = await tmpdir({ git: true, config: { model: "test/model" } })

  spyOn(Provider, "getModel").mockResolvedValue({
    id: "model",
    providerID: "test",
    api: { id: "model" },
    capabilities: { input: {} },
  } as any)
  const promptCalls: Array<Parameters<typeof SessionPrompt.prompt>[0]> = []
  spyOn(SessionPrompt, "prompt").mockImplementation(async (input) => {
    promptCalls.push(input)
    const text = promptCalls.length === 1 ? "first explore findings" : "resumed explore findings"
    const userMessageID = Identifier.ascending("message")
    await SessionAPI.updateMessage({
      id: userMessageID,
      sessionID: input.sessionID,
      role: "user",
      time: { created: Date.now() },
      agent: input.agent,
      model: input.model,
      system: input.system,
      systemMode: input.systemMode,
      tools: input.tools,
      extra: input.extra,
    } as Message.User)
    return {
      info: {
        id: Identifier.ascending("message"),
        sessionID: input.sessionID,
        role: "assistant",
        parentID: userMessageID,
        time: { created: Date.now() },
        agent: "explore",
        providerID: input.model.providerID,
        modelID: input.model.modelID,
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        path: { cwd: tmp.path, root: tmp.path },
      },
      parts: [
        {
          id: Identifier.ascending("part"),
          sessionID: input.sessionID,
          messageID: Identifier.ascending("message"),
          type: "text",
          text,
        },
      ],
    } as Awaited<ReturnType<typeof SessionPrompt.prompt>>
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const parent = await SessionAPI.create({ kind: "assistant", title: "task parent" })
      const assistant = await SessionAPI.updateMessage(assistantMessageInput(parent.id))
      const tool = await TaskTool.init()
      const context = {
        sessionID: parent.id,
        messageID: assistant.id,
        agent: "general",
        abort: new AbortController().signal,
        messages: [],
        metadata() {},
        async ask() {},
        extra: { bypassAgentCheck: true },
      }

      const first = await tool.execute(
        {
          description: "inspect source",
          prompt: "Find the implementation.",
          subagent_type: "explore",
        },
        context,
      )

      const childSessionID = first.metadata.sessionId
      expect(first.output).toContain(`task_id: ${childSessionID}`)
      expect(first.output).toContain("first explore findings")
      const child = await SessionAPI.get(childSessionID)
      expect(child.kind).toBe("explore")
      expect(child.metadata).toMatchObject(taskToolSessionMetadata("explore"))
      expect(promptCalls[0].agent).toBe("explore")
      expect(promptCalls[0].tools).toMatchObject({
        todowrite: false,
        todoread: false,
      })

      const firstMessages = await SessionAPI.messages({ sessionID: childSessionID })
      const firstSource = firstMessages.find((message) => message.info.role === "user")
      const firstDescriptor = (firstSource?.info.extra as any)?.workerTurnDescriptor
      expect(typeof firstDescriptor?.id).toBe("string")
      expect(typeof firstDescriptor?.hash).toBe("string")
      await SessionCompaction.create({
        sessionID: childSessionID,
        source: firstSource!.info as Message.User,
        auto: true,
        overflow: true,
      })
      expect(SessionControl.pending(childSessionID)).toHaveLength(1)

      const resumed = await tool.execute(
        {
          description: "inspect source",
          prompt: "Continue the same investigation.",
          subagent_type: "explore",
          task_id: childSessionID,
        },
        context,
      )

      expect(resumed.metadata.sessionId).toBe(childSessionID)
      expect(resumed.output).toContain("resumed explore findings")
      const resumedMessages = await SessionAPI.messages({ sessionID: childSessionID })
      const resumedSource = resumedMessages.filter((message) => message.info.role === "user").at(-1)
      const resumedDescriptor = (resumedSource?.info.extra as any)?.workerTurnDescriptor
      expect(typeof resumedDescriptor?.id).toBe("string")
      expect(resumedDescriptor.id).not.toBe(firstDescriptor.id)
      await SessionCompaction.create({
        sessionID: childSessionID,
        source: resumedSource!.info as Message.User,
        auto: true,
        overflow: true,
      })
      expect(SessionControl.pending(childSessionID)).toHaveLength(2)
      SessionPrompt.clearSessionRuntimeContract(childSessionID)
    },
  })
})
