import { afterEach, expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { Database } from "../../src/storage/db"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { EngineService } from "../../src/task-api"
import { Instance } from "../../src/project/instance"
import { Identifier } from "../../src/id/id"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"
import { Worktree } from "../../src/worktree"
import { Session } from "../../src/session"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

const previousTraceDir = process.env.OPENCORVUS_AGENT_TRACE_DIR
const previousRedactAttachments = process.env.OPENCORVUS_AGENT_TRACE_REDACT_ATTACHMENTS
const previousEventMaxBytes = process.env.OPENCORVUS_AGENT_TRACE_EVENT_MAX_BYTES
const previousBlobMaxBytes = process.env.OPENCORVUS_AGENT_TRACE_BLOB_MAX_BYTES
const previousTaskBlobMaxBytes = process.env.OPENCORVUS_AGENT_TRACE_TASK_BLOB_MAX_BYTES
let tempDir = ""

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

function seedTraceTask(input: { projectID: string; taskID: string; sessionID?: string }) {
  const now = Date.now()
  Database.use((db) =>
    db
      .insert(EngineTaskTable)
      .values({
        id: input.taskID,
        project_id: input.projectID,
        session_id: input.sessionID,
        source: "test",
        title: "trace task",
        request: "trace task",
        priority: "normal",
        budget: { max_executor_groups: 1 },
        time_created: now,
        time_updated: now,
        time_started: now,
      })
      .run(),
  )
}

afterEach(async () => {
  restoreEnv("OPENCORVUS_AGENT_TRACE_DIR", previousTraceDir)
  restoreEnv("OPENCORVUS_AGENT_TRACE_REDACT_ATTACHMENTS", previousRedactAttachments)
  restoreEnv("OPENCORVUS_AGENT_TRACE_EVENT_MAX_BYTES", previousEventMaxBytes)
  restoreEnv("OPENCORVUS_AGENT_TRACE_BLOB_MAX_BYTES", previousBlobMaxBytes)
  restoreEnv("OPENCORVUS_AGENT_TRACE_TASK_BLOB_MAX_BYTES", previousTaskBlobMaxBytes)
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true })
  tempDir = ""
  await Instance.disposeAll()
  await resetDatabase()
})

test("trace override rejects legacy .opencorvus/runtime layout", async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "oc-trace-legacy-"))
  process.env.OPENCORVUS_AGENT_TRACE_DIR = path.join(tempDir, ".opencorvus", "runtime")
  const { AgentTrace } = await import("../../src/trace")

  expect(() => AgentTrace.getTraceDir()).toThrow("legacy runtime layout")
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

test(
  "session trace service reads from the task primary runtime when called inside a managed worktree",
  async () => {
    restoreEnv("OPENCORVUS_AGENT_TRACE_DIR", undefined)
    const { AgentTrace } = await import("../../src/trace")

    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "root", title: "trace primary runtime" })
        const taskID = Identifier.create("task", false)
        seedTraceTask({ projectID: Instance.project.id, taskID, sessionID: session.id })
        AgentTrace.recordLLMRequest({
          sessionID: session.id,
          taskID,
          agentName: "orchestrator",
          agentMode: "task",
          model: { providerID: "test", modelID: "model" },
          system: ["system"],
          messages: [{ role: "user", content: "hi" }],
          tools: [],
        })

        const worktree = await Worktree.create({ name: "trace-primary-runtime", taskID, sessionID: session.id })
        await Instance.provide({
          directory: worktree.directory,
          fn: async () => {
            const trace = await EngineService.getSessionTrace(session.id)
            expect(trace.traceDir).toBe(ProjectRuntimePaths.projectRuntimeRoot(tmp.path))
            expect(trace.events).toHaveLength(1)
            expect(trace.events[0]?.kind).toBe("llm_request")
          },
        })
      },
    })
  },
  { timeout: 20_000 },
)

test("task trace writes to the primary project runtime when ambient directory is a build worktree", async () => {
  delete process.env.OPENCORVUS_AGENT_TRACE_DIR
  await using tmp = await tmpdir({ git: true })
  const { AgentTrace } = await import("../../src/trace")
  const sessionID = Identifier.create("session", false)
  const taskID = Identifier.create("task", false)

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      seedTraceTask({ projectID: Instance.project.id, taskID })
      const worktree = await Worktree.create({
        name: "trace-primary-runtime",
        taskID,
        sessionID,
      })

      await Instance.provide({
        directory: worktree.directory,
        fn: async () => {
          AgentTrace.recordLLMRequest({
            sessionID,
            taskID,
            agentName: "build",
            model: { providerID: "test", modelID: "model" },
            system: ["system"],
            messages: [{ role: "user", content: "hi" }],
            tools: [],
          })
        },
      })

      const primaryTrace = ProjectRuntimePaths.tracePath(tmp.path, taskID, sessionID)
      const worktreeTrace = ProjectRuntimePaths.tracePath(worktree.directory, taskID, sessionID)
      expect(fs.existsSync(primaryTrace)).toBe(true)
      expect(fs.existsSync(worktreeTrace)).toBe(false)
      expect(AgentTrace.readSessionEvents(sessionID, taskID)[0]).toMatchObject({
        domain: "session",
        sessionID,
        taskID,
        kind: "llm_request",
      })
    },
  })
}, 30_000)

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
      const index = fs
        .readFileSync(indexPath, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
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

test("task trace reader parses only the bounded tail of large trace files", async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "oc-trace-tail-"))
  process.env.OPENCORVUS_AGENT_TRACE_DIR = tempDir
  const { AgentTrace } = await import("../../src/trace")
  const taskID = Identifier.create("task", false)

  await Instance.provide({
    directory: tempDir,
    fn: async () => {
      const file = ProjectRuntimePaths.taskAbsoluteFromRuntimeRoot(tempDir, taskID, "trace.jsonl")
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(
        file,
        JSON.stringify({
          ts: 1,
          kind: "llm_request",
          taskID,
          agentName: "old",
          payload: { text: "x".repeat(2 * 1024 * 1024 + 1000) },
        }) +
          "\n" +
          JSON.stringify({
            ts: 2,
            kind: "agent_report",
            taskID,
            agentName: "tail",
            payload: { ok: true },
          }) +
          "\n",
        "utf8",
      )

      const events = AgentTrace.readTaskEvents(taskID)
      expect(events.map((event) => event.agentName)).toEqual(["tail"])
    },
  })
})

test("llm request trace redacts data URLs by default", async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "oc-trace-redact-"))
  process.env.OPENCORVUS_AGENT_TRACE_DIR = tempDir
  const { AgentTrace } = await import("../../src/trace")
  const sessionID = Identifier.create("session", false)
  const taskID = Identifier.create("task", false)
  const dataURL = `data:image/png;base64,${"a".repeat(2048)}`

  await Instance.provide({
    directory: tempDir,
    fn: async () => {
      AgentTrace.recordLLMRequest({
        sessionID,
        taskID,
        agentName: "build",
        model: { providerID: "test", modelID: "model" },
        system: ["system"],
        messages: [{ role: "user", content: [{ type: "image", image: dataURL }] }],
        tools: [],
      })

      const raw = fs.readFileSync(
        ProjectRuntimePaths.taskAbsoluteFromRuntimeRoot(tempDir, taskID, "trace.jsonl"),
        "utf8",
      )
      expect(raw).not.toContain(dataURL)
      expect(raw).toContain("[redacted data URL")
    },
  })
})

test("oversized trace payloads are stored behind a blob reference", async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "oc-trace-blob-"))
  process.env.OPENCORVUS_AGENT_TRACE_DIR = tempDir
  process.env.OPENCORVUS_AGENT_TRACE_EVENT_MAX_BYTES = "1024"
  process.env.OPENCORVUS_AGENT_TRACE_BLOB_MAX_BYTES = "200000"
  process.env.OPENCORVUS_AGENT_TRACE_TASK_BLOB_MAX_BYTES = "200000"
  const { AgentTrace } = await import("../../src/trace")
  const taskID = Identifier.create("task", false)
  const largeText = "trace-blob-marker-" + "x".repeat(10_000)

  await Instance.provide({
    directory: tempDir,
    fn: async () => {
      AgentTrace.recordHelperLLMCall({
        taskID,
        agentName: "helper",
        model: { providerID: "test", modelID: "model" },
        messages: [{ role: "user", content: largeText }],
        output: { ok: true },
      })

      const events = AgentTrace.readTaskEvents(taskID)
      expect(events).toHaveLength(1)
      const ref = (events[0]?.payload as any)?.tracePayloadRef
      expect(typeof ref?.sha256).toBe("string")
      const sha256 = ref.sha256
      expect(events[0]).toMatchObject({
        traceBounded: true,
        payload: {
          tracePayloadRef: {
            bytes: expect.any(Number),
            sha256: expect.any(String),
          },
          summary: { type: "object" },
        },
      })
      const eventText = JSON.stringify(events[0])
      expect(eventText).not.toContain(largeText)
      const blobPath = ProjectRuntimePaths.taskAbsoluteFromRuntimeRoot(
        tempDir,
        taskID,
        "trace",
        "blobs",
        `${sha256}.json`,
      )
      expect(fs.readFileSync(blobPath, "utf8")).toContain(largeText)
    },
  })
})

test("oversized trace payloads are explicitly truncated when blob quotas reject them", async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "oc-trace-truncate-"))
  process.env.OPENCORVUS_AGENT_TRACE_DIR = tempDir
  process.env.OPENCORVUS_AGENT_TRACE_EVENT_MAX_BYTES = "1024"
  process.env.OPENCORVUS_AGENT_TRACE_BLOB_MAX_BYTES = "2048"
  process.env.OPENCORVUS_AGENT_TRACE_TASK_BLOB_MAX_BYTES = "2048"
  const { AgentTrace } = await import("../../src/trace")
  const taskID = Identifier.create("task", false)

  await Instance.provide({
    directory: tempDir,
    fn: async () => {
      AgentTrace.recordHelperLLMCall({
        taskID,
        agentName: "helper",
        model: { providerID: "test", modelID: "model" },
        messages: [{ role: "user", content: "x".repeat(10_000) }],
        output: { ok: true },
      })

      const events = AgentTrace.readTaskEvents(taskID)
      expect(events[0]).toMatchObject({
        traceBounded: true,
        payload: {
          tracePayloadTruncated: true,
          reason: "single_blob_limit",
          summary: { type: "object" },
        },
      })
      const blobRoot = ProjectRuntimePaths.taskAbsoluteFromRuntimeRoot(tempDir, taskID, "trace", "blobs")
      expect(fs.existsSync(blobRoot)).toBe(false)
    },
  })
})
