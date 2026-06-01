import { afterEach, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { Session } from "../../src/session"
import { Instance } from "../../src/project/instance"
import { Identifier } from "../../src/id/id"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"

const previousTraceDir = process.env.OPENCORVUS_AGENT_TRACE_DIR
let tempDir = ""

afterEach(() => {
  if (previousTraceDir === undefined) delete process.env.OPENCORVUS_AGENT_TRACE_DIR
  else process.env.OPENCORVUS_AGENT_TRACE_DIR = previousTraceDir
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true })
  tempDir = ""
})

test("task trace rollup includes llm_request task and parent metadata", async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "oc-trace-rollup-"))
  process.env.OPENCORVUS_AGENT_TRACE_DIR = tempDir
  const { AgentTrace } = await import("../../src/trace")
  const sessionID = Identifier.create("session", false)
  const taskID = Identifier.create("task", false)
  const parentSessionID = Identifier.create("session", false)

  await Instance.provide({
    directory: tempDir,
    fn: async () => {
      AgentTrace.recordLLMRequest({
        sessionID,
        parentSessionID,
        taskID,
        agentName: "build",
        agentMode: "subagent",
        model: { providerID: "test", modelID: "model" },
        system: ["system"],
        messages: [{ role: "user", content: "hi" }],
        tools: [],
      })

      const events = AgentTrace.readTaskEvents(taskID)
      expect(events).toHaveLength(1)
      expect(events[0]?.kind).toBe("llm_request")
      expect(events[0]?.sessionID).toBe(sessionID)
      expect(events[0]?.taskID).toBe(taskID)
      expect(events[0]?.parentSessionID).toBe(parentSessionID)
      expect(events[0]?.domain).toBe("session")
    },
  })
})

test("helper trace writes explicit non-session domain instead of fake session bucket", async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "oc-trace-domain-"))
  process.env.OPENCORVUS_AGENT_TRACE_DIR = tempDir
  const { AgentTrace } = await import("../../src/trace")
  const agentName = `helper_${Date.now()}`
  const taskID = Identifier.create("task", false)

  await Instance.provide({
    directory: tempDir,
    fn: async () => {
      const bucket = AgentTrace.recordHelperLLMCall({
        taskID,
        agentName,
        model: { providerID: "test", modelID: "model" },
        messages: [{ role: "user", content: "generate" }],
        output: { ok: true },
      })

      expect(bucket).toBe(AgentTrace.NON_SESSION_DOMAIN)
      expect(fs.readdirSync(tempDir).some((name) => name.startsWith("helper-"))).toBe(false)

      const events = AgentTrace.readDomainEvents(AgentTrace.NON_SESSION_DOMAIN, taskID)
      expect(events).toHaveLength(1)
      expect(events[0]?.kind).toBe("helper_llm_call")
      expect(events[0]?.domain).toBe(AgentTrace.NON_SESSION_DOMAIN)
      expect(events[0]?.sessionID).toBeUndefined()

      const indexPath = ProjectRuntimePaths.taskAbsoluteFromRuntimeRoot(tempDir, taskID, "trace", "_index.jsonl")
      const index = fs.readFileSync(indexPath, "utf8").trim().split("\n").map((line) => JSON.parse(line))
      expect(index).toContainEqual(
        expect.objectContaining({
          kind: "domain_open",
          domain: AgentTrace.NON_SESSION_DOMAIN,
          agentName,
          firstEvent: "helper_llm_call",
        }),
      )
    },
  })
})

test("trace validates ambient SessionContext session bucket", async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "oc-trace-session-context-"))
  process.env.OPENCORVUS_AGENT_TRACE_DIR = tempDir
  const { AgentTrace } = await import("../../src/trace")
  const { SessionContext } = await import("../../src/session/context")
  const sessionID = Identifier.create("session", false)
  const session = {
    id: sessionID,
    slug: "context",
    projectID: "project",
    directory: tempDir,
    title: "Context",
    version: "1.0.0",
    kind: "assistant",
    time: { created: 1, updated: 1 },
  } satisfies Session.Info
  const taskID = Identifier.create("task", false)

  await Instance.provide({
    directory: tempDir,
    fn: async () => {
      SessionContext.provide(session, () => {
        AgentTrace.recordLLMRequest({
          sessionID,
          taskID,
          agentName: "assistant",
          model: { providerID: "test", modelID: "model" },
          system: ["system"],
          messages: [{ role: "user", content: "hi" }],
          tools: [],
        })
      })

      expect(AgentTrace.readSessionEvents(sessionID)[0]).toMatchObject({
        domain: "session",
        sessionID,
        kind: "llm_request",
      })

      expect(() =>
        SessionContext.provide(session, () => {
          AgentTrace.recordLLMRequest({
            sessionID: Identifier.create("session", false),
            taskID,
            agentName: "assistant",
            model: { providerID: "test", modelID: "model" },
            system: ["system"],
            messages: [{ role: "user", content: "hi" }],
            tools: [],
          })
        }),
      ).toThrow("Trace session mismatch")
    },
  })
})

test("orchestrator trace report writes under child session while mission session is ambient", async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "oc-trace-orchestrator-context-"))
  process.env.OPENCORVUS_AGENT_TRACE_DIR = tempDir
  const { AgentTrace } = await import("../../src/trace")
  const { SessionContext } = await import("../../src/session/context")
  const { recordOrchestratorTraceReportForSession } = await import("../../src/orchestrator/agent")
  const parentSessionID = Identifier.create("session", false)
  const childSessionID = Identifier.create("session", false)
  const taskID = Identifier.create("task", false)
  const parentSession = {
    id: parentSessionID,
    slug: "mission",
    projectID: "project",
    directory: tempDir,
    title: "Mission",
    version: "1.0.0",
    kind: "mission",
    time: { created: 1, updated: 1 },
  } satisfies Session.Info
  const childSession = {
    id: childSessionID,
    slug: "orchestrator",
    projectID: "project",
    directory: tempDir,
    title: "Orchestrator",
    version: "1.0.0",
    kind: "orchestrator",
    time: { created: 2, updated: 2 },
  } satisfies Session.Info

  await Instance.provide({
    directory: tempDir,
    fn: async () => {
      SessionContext.provide(parentSession, () => {
        expect(() =>
          recordOrchestratorTraceReportForSession(childSession, {
            sessionID: childSessionID,
            parentSessionID,
            taskID,
            agentName: "orchestrator",
            kind: "orchestrator_wake",
            finishReason: "stop",
            report: {
              summary: "orchestrator completed",
              detail: "orchestrator completed",
            },
          }),
        ).not.toThrow()
      })

      const childEvents = AgentTrace.readSessionEvents(childSessionID)
      expect(childEvents).toHaveLength(1)
      expect(childEvents[0]).toMatchObject({
        domain: "session",
        sessionID: childSessionID,
        parentSessionID,
        taskID,
        kind: "orchestrator_wake",
      })
      expect(AgentTrace.readTaskEvents(taskID).map((event) => event.sessionID)).toEqual([childSessionID])
    },
  })
})
