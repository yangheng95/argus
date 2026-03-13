import { afterEach, describe, expect, mock, test } from "bun:test"
import { Identifier } from "../../src/id/id"
import { OrchestratorTaskTable } from "../../src/orchestrator/orchestrator.sql"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
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
        const sessions = [...Session.list({ roots: true })].filter((item) => !item.title.startsWith("Panel control ("))

        expect(output.kind).toBe("panel_response")
        expect(output.message).toContain("explicit user request")
        expect(sessions).toHaveLength(0)
      },
    })
  })
})
