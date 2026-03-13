import { afterEach, describe, expect, mock, test } from "bun:test"
import { Database } from "../../src/storage/db"
import { Identifier } from "../../src/id/id"
import {
  OrchestratorExecutorEventTable,
  OrchestratorExecutorSessionTable,
  OrchestratorRunTable,
  OrchestratorTaskTable,
} from "../../src/orchestrator/orchestrator.sql"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("executor session routes", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
  })

  test("GET /run/:id/executor and /run/:id/executor-events expose protocol session data", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const session = await Session.create({ title: "executor-session-test" })
        const taskID = Identifier.ascending("task")
        const runID = Identifier.ascending("run")
        const executorSessionID = Identifier.ascending("executor_session")
        const now = Date.now()

        Database.use((db) =>
          db.insert(OrchestratorTaskTable).values({
            id: taskID,
            project_id: Instance.project.id,
            session_id: session.id,
            active_run_id: runID,
            source: "test",
            title: "executor session test",
            request: "executor session test",
            status: "completed",
            priority: "normal",
            time_created: now,
            time_updated: now,
            time_completed: now,
          }).run(),
        )
        Database.use((db) =>
          db.insert(OrchestratorRunTable).values({
            id: runID,
            task_id: taskID,
            session_id: session.id,
            executor: "codex",
            status: "completed",
            phase: "dispatch",
            retry_count: 0,
            time_created: now,
            time_updated: now,
            time_started: now,
            time_completed: now,
          }).run(),
        )
        Database.use((db) =>
          db.insert(OrchestratorExecutorSessionTable).values({
            id: executorSessionID,
            task_id: taskID,
            run_id: runID,
            provider: "codex",
            protocol: "codex-app-server",
            protocol_version: "v2",
            transport: "stdio",
            status: "completed",
            refs: {
              provider_session_id: "resp_codex",
            },
            capabilities: {
              stream: true,
              resume: true,
              interrupt: true,
              builtin_tools: true,
              custom_tools: false,
              structured_output: true,
              approvals: ["command", "file_change", "patch", "user_input", "dynamic_tool"],
              reasoning: true,
              plan_updates: true,
              diff_updates: true,
              mcp: true,
              usage: true,
              realtime: true,
              spec_generation: true,
              plan_generation: true,
              tool_kinds: ["builtin", "dynamic", "approval", "input", "mcp", "shell", "patch", "read", "review", "plan", "structured_output", "unknown"],
            },
            settings: {
              cwd: tmp.path,
              model: "gpt-5.3-codex",
            },
            time_created: now,
            time_updated: now,
            time_started: now,
            time_completed: now,
          }).run(),
        )
        Database.use((db) =>
          db.insert(OrchestratorExecutorEventTable).values({
            id: Identifier.ascending("executor_event"),
            executor_session_id: executorSessionID,
            task_id: taskID,
            run_id: runID,
            sequence: 1,
            kind: "lifecycle",
            summary: "Run accepted by executor",
            payload: {
              provider: "codex",
            },
            raw: {
              type: "response.created",
            },
            time_observed: now,
            time_created: now,
            time_updated: now,
          }).run(),
        )

        const sessionRes = await app.request(`/run/${runID}/executor`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(sessionRes.status).toBe(200)
        const executorSession = (await sessionRes.json()) as {
          provider: string
          protocol: string
          status: string
        }
        expect(executorSession.provider).toBe("codex")
        expect(executorSession.protocol).toBe("codex-app-server")
        expect(["active", "completed"]).toContain(executorSession.status)

        const eventsRes = await app.request(`/run/${runID}/executor-events`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(eventsRes.status).toBe(200)
        const events = await eventsRes.json() as Array<{ kind: string }>
        expect(events.length).toBeGreaterThan(0)
        expect(events.some((item) => item.kind === "lifecycle")).toBe(true)
      },
    })
  })
})
