import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Identifier } from "../../src/id/id"
import { OpencodeExecutor } from "../../src/executor/opencode"
import { PlannerService } from "../../src/planner/service"
import { OrchestratorTaskTable } from "../../src/orchestrator/orchestrator.sql"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SpecService } from "../../src/spec/service"
import { Database, eq } from "../../src/storage/db"
import { PanelTool } from "../../src/tool/panel"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("panel tool", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
  })

  test("create_task applies create-task budget defaults before initial planning", async () => {
    await using tmp = await tmpdir({ git: true })
    const total = 480_000
    const specMs = 97_200
    const plannerMs = 118_800
    const submit = spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
      sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))
    const spec = spyOn(SpecService, "initial").mockImplementation(async (input) => {
      expect(input.timeoutMs).toBe(specMs)
      return {
        summary: "Spec",
        content: "# Scope\n\nImplement feature x",
        goals: [{
          description: "Implement feature x",
          criteria: "Feature x works",
          priority: "blocking" as const,
        }],
        assumptions: [],
        risks: [],
        clarifications: [],
        spec_items: [{
          title: "Implement feature x",
          description: "Feature x works",
          priority: "blocking" as const,
          check_selector: ["spec_check"],
        }],
        evidence_sources: [],
        unresolved_questions: [],
      }
    })
    const plan = spyOn(PlannerService, "initial").mockImplementation(async (input) => {
      expect(input.timeoutMs).toBe(plannerMs)
      return {
        summary: "Plan",
        prompt: "Implement feature x",
        goals: [{
          description: "Implement feature x",
          criteria: "Feature x works",
          priority: "blocking" as const,
        }],
        metadata: {
          strategy: "initial" as const,
          steps: ["Implement feature x"],
        },
      }
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await PanelTool.init()
        const result = await tool.execute(
          {
            action: "create_task",
            request: "Implement feature x",
            metadata: {
              ui_context: "benchmark",
              create_task: {
                budget: {
                  maxWallTimeMs: total,
                },
              },
            },
          },
          {
            sessionID: Identifier.ascending("session"),
            messageID: Identifier.ascending("message"),
            agent: "panel-test",
            abort: new AbortController().signal,
            messages: [],
            metadata() {},
            async ask() {},
            extra: {
              surface: "panel",
              createTask: {
                budget: {
                  maxWallTimeMs: total,
                },
              },
            },
          },
        )
        const output = JSON.parse(result.output)
        const row = Database.use((db) =>
          db
            .select({
              budget: OrchestratorTaskTable.budget,
              metadata: OrchestratorTaskTable.metadata,
            })
            .from(OrchestratorTaskTable)
            .where(eq(OrchestratorTaskTable.id, output.task_id))
            .get(),
        )

        expect(row?.budget?.max_wall_time_ms).toBe(total)
        expect(row?.metadata?.ui_context).toBe("benchmark")
        expect(row?.metadata?.create_task).toBeUndefined()
      },
    })

    expect(spec).toHaveBeenCalledTimes(1)
    expect(plan).toHaveBeenCalledTimes(1)
    expect(submit).toHaveBeenCalledTimes(1)
  })

  test("delete_session deletes every linked task", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "bulk session" })
        const prefix = `bulk-${session.id}-`
        const now = Date.now()

        Database.use((db) =>
          db
            .insert(OrchestratorTaskTable)
            .values(
              Array.from({ length: 101 }, (_, index) => ({
                id: Identifier.ascending("task"),
                project_id: Instance.project.id,
                session_id: session.id,
                source: "panel",
                title: `${prefix}${index + 1}`,
                request: `${prefix}${index + 1}`,
                status: "running" as const,
                priority: "normal" as const,
                time_created: now,
                time_updated: now,
              })),
            )
            .run(),
        )

        const tool = await PanelTool.init()
        const result = await tool.execute(
          {
            action: "delete_session",
            sessionID: session.id,
          },
          {
            sessionID: Identifier.ascending("session"),
            messageID: Identifier.ascending("message"),
            agent: "panel-test",
            abort: new AbortController().signal,
            messages: [],
            metadata() {},
            async ask() {},
            extra: { surface: "panel" },
          },
        )
        const output = JSON.parse(result.output)

        const tasks = Database.use((db) =>
          db
            .select({
              title: OrchestratorTaskTable.title,
              status: OrchestratorTaskTable.status,
              session_id: OrchestratorTaskTable.session_id,
            })
            .from(OrchestratorTaskTable)
            .all(),
        )
        const current = tasks.filter((item) => item.title.startsWith(prefix))

        expect(current).toHaveLength(0)
        expect(output.session_id).toBe(session.id)
        expect(output.local_action).toEqual({
          type: "invalidate_session",
          sessionID: session.id,
        })
      },
    })
  })

  test("update_checks preserves advanced config when panel toggles standard checks", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = Identifier.ascending("task")
        const now = Date.now()

        Database.use((db) =>
          db
            .insert(OrchestratorTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              source: "panel",
              title: "check selection",
              request: "check selection",
              status: "queued",
              priority: "normal",
              metadata: {
                checks: {
                  build: false,
                  lint: ["bun", "run", "lint"],
                  code_quality: {
                    enabled: true,
                    prompt: "preserve me",
                  },
                  visual: {
                    target: "web",
                    url: "https://example.com/review",
                  },
                },
              },
              time_created: now,
              time_updated: now,
            })
            .run(),
        )

        const tool = await PanelTool.init()
        await tool.execute(
          {
            action: "update_checks",
            taskID,
            selection: {
              lint: true,
              build: true,
              test: false,
              artifact: true,
              ui_review: true,
              code_quality: true,
              code_review: true,
              spec_check: true,
            },
          },
          {
            sessionID: Identifier.ascending("session"),
            messageID: Identifier.ascending("message"),
            agent: "panel-test",
            abort: new AbortController().signal,
            messages: [],
            metadata() {},
            async ask() {},
            extra: { surface: "panel" },
          },
        )

        const row = Database.use((db) =>
          db
            .select({
              metadata: OrchestratorTaskTable.metadata,
            })
            .from(OrchestratorTaskTable)
            .where(eq(OrchestratorTaskTable.id, taskID))
            .get(),
        )

        expect(row?.metadata?.checks).toEqual({
          test: false,
          artifact: {},
          code_quality: {
            enabled: true,
            prompt: "preserve me",
          },
          code_review: {
            enabled: true,
          },
          ui_review: {
            target: "web",
          },
          visual: {
            target: "web",
            url: "https://example.com/review",
            },
            spec_check: {
              enabled: true,
              mode: "strict",
            },
            lint: ["bun", "run", "lint"],
          })
      },
    })
  })

  test("view_panel_settings and update_panel_settings round-trip session settings", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "settings target" })
        const tool = await PanelTool.init()
        const ctx = {
          sessionID: Identifier.ascending("session"),
          messageID: Identifier.ascending("message"),
          agent: "panel-test",
          abort: new AbortController().signal,
          messages: [],
          metadata() {},
          async ask() {},
          extra: { surface: "panel" },
        }

        const updated = await tool.execute(
          {
            action: "update_panel_settings",
            sessionID: session.id,
            settings: {
              theme: "light",
              zoom: 1.25,
            },
          },
          ctx,
        )

        expect(JSON.parse(updated.output)).toMatchObject({
          session_id: session.id,
          settings: {
            theme: "light",
            zoom: 1.25,
          },
        })

        const viewed = await tool.execute(
          {
            action: "view_panel_settings",
            sessionID: session.id,
          },
          ctx,
        )

        expect(JSON.parse(viewed.output)).toMatchObject({
          session_id: session.id,
          settings: {
            theme: "light",
            zoom: 1.25,
          },
        })
      },
    })
  })

  test("call_panel_api can read allowlisted panel routes", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await PanelTool.init()
        const result = await tool.execute(
          {
            action: "call_panel_api",
            method: "GET",
            path: "panel/capabilities",
            query: {
              surface: "panel",
            },
          },
          {
            sessionID: Identifier.ascending("session"),
            messageID: Identifier.ascending("message"),
            agent: "panel-test",
            abort: new AbortController().signal,
            messages: [],
            metadata() {},
            async ask() {},
            extra: { surface: "panel" },
          },
        )
        const output = JSON.parse(result.output)

        expect(output.response.status).toBe(200)
        expect(Array.isArray(output.response.data.actions)).toBe(true)
        expect(output.response.data.actions.some((item: { action?: string }) => item.action === "view_spec")).toBe(true)
      },
    })
  })

  test("call_panel_api blocks session mutations without explicit permission", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await PanelTool.init()
        const result = await tool.execute(
          {
            action: "call_panel_api",
            method: "POST",
            path: "session",
            body: {},
          },
          {
            sessionID: Identifier.ascending("session"),
            messageID: Identifier.ascending("message"),
            agent: "panel-test",
            abort: new AbortController().signal,
            messages: [],
            metadata() {},
            async ask() {},
            extra: { surface: "panel", allowSessionMutation: false },
          },
        )
        const output = JSON.parse(result.output)
        const sessions = [...Session.list({ roots: true })].filter((item) => !item.title.startsWith("Control ("))

        expect(output.kind).toBe("panel_response")
        expect(output.message).toContain("explicit user request")
        expect(sessions).toHaveLength(0)
      },
    })
  })
})
