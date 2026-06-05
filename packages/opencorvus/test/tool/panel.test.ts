import { afterEach, describe, expect, mock, test } from "bun:test"
import { Identifier } from "../../src/id/id"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Database, eq } from "../../src/storage/db"
import { PanelTool } from "../../src/tool/panel"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import { RIGHT_SIDEBAR_CODING_ASSISTANT_METADATA } from "../../src/coding-assistant/session"

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
        const session = await Session.create({ kind: "assistant", title: "bulk session" })
        const prefix = `bulk-${session.id}-`
        const now = Date.now()

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values(
              Array.from({ length: 101 }, (_, index) => ({
                id: Identifier.ascending("task"),
                project_id: Instance.project.id,
                session_id: session.id,
                source: "panel",
                title: `${prefix}${index + 1}`,
                request: `${prefix}${index + 1}`,
                status: "active" as const,
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

        // audit-2026-04-29 W2-V33 — `status` was removed from
        // EngineTaskTable in Phase-6-f-2 (see engine.sql.ts:240-242:
        // "Derive via engine/task-status.ts::deriveTaskStatus from
        // time_started + time_completed + error + cancelled"). The
        // pre-fix select referenced EngineTaskTable.status which is
        // now undefined → drizzle's orderSelectedFields threw on
        // the undefined column. Drop it; the test only filters by
        // title prefix below, no need to project status.
        const tasks = Database.use((db) =>
          db
            .select({
              title: EngineTaskTable.title,
              session_id: EngineTaskTable.session_id,
            })
            .from(EngineTaskTable)
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
  }, 15_000)

  test("right sidebar assistant create_task writes server-derived provenance", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({
          kind: "assistant",
          title: "right sidebar assistant",
          metadata: RIGHT_SIDEBAR_CODING_ASSISTANT_METADATA,
        })

        const tool = await PanelTool.init()
        const result = await tool.execute(
          {
            action: "create_task",
            request: "inspect project tasks",
            queue: true,
            source: "mission",
            metadata: {
              actor: "forged",
              mission: { id: "forged" },
              keep: "value",
            },
          },
          {
            sessionID: session.id,
            messageID: Identifier.ascending("message"),
            agent: "coding",
            abort: new AbortController().signal,
            messages: [],
            metadata() {},
            async ask() {},
            extra: { surface: "right-sidebar", source: "panel" },
          },
        )

        const output = JSON.parse(result.output) as { task_id: string }
        const task = Database.use((db) =>
          db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, output.task_id)).get(),
        )

        expect(task?.source).toBe("right-sidebar-assistant")
        expect(task?.metadata).toMatchObject({
          actor: "right_sidebar_assistant",
          keep: "value",
        })
        expect((task?.metadata as Record<string, unknown> | undefined)?.mission).toBeUndefined()
      },
    })
  }, 15_000)

  test("right sidebar assistant cannot manage sessions through panel tool", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({
          kind: "assistant",
          metadata: RIGHT_SIDEBAR_CODING_ASSISTANT_METADATA,
        })
        const tool = await PanelTool.init()

        await expect(
          tool.execute(
            {
              action: "delete_session",
              sessionID: session.id,
            },
            {
              sessionID: session.id,
              messageID: Identifier.ascending("message"),
              agent: "coding",
              abort: new AbortController().signal,
              messages: [],
              metadata() {},
              async ask() {},
              extra: { surface: "right-sidebar" },
            },
          ),
        ).rejects.toThrow("not permitted for the right sidebar assistant")
      },
    })
  })

  test("explore agent may inspect project state but cannot mutate through panel tool", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "explore", title: "explore status" })
        const tool = await PanelTool.init()

        const inspect = await tool.execute(
          {
            action: "view_tasks",
          },
          {
            sessionID: session.id,
            messageID: Identifier.ascending("message"),
            agent: "explore",
            abort: new AbortController().signal,
            messages: [],
            metadata() {},
            async ask() {},
            extra: { surface: "panel" },
          },
        )
        expect(inspect.title).toBe("Tasks")

        await expect(
          tool.execute(
            {
              action: "create_task",
              request: "should not be allowed",
              queue: true,
            },
            {
              sessionID: session.id,
              messageID: Identifier.ascending("message"),
              agent: "explore",
              abort: new AbortController().signal,
              messages: [],
              metadata() {},
              async ask() {},
              extra: { surface: "panel" },
            },
          ),
        ).rejects.toThrow("not permitted for the explore agent")
      },
    })
  })

  test("right sidebar assistant local actions are authorized by the capability surface", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({
          kind: "assistant",
          metadata: RIGHT_SIDEBAR_CODING_ASSISTANT_METADATA,
        })
        const tool = await PanelTool.init()

        const result = await tool.execute(
          {
            action: "select_task",
            taskID: "task-right-sidebar",
          },
          {
            sessionID: session.id,
            messageID: Identifier.ascending("message"),
            agent: "coding",
            abort: new AbortController().signal,
            messages: [],
            metadata() {},
            async ask() {},
            extra: { surface: "right-sidebar" },
          },
        )

        expect(JSON.parse(result.output)).toMatchObject({
          kind: "panel_response",
          task_id: "task-right-sidebar",
          local_action: { type: "select_task", taskID: "task-right-sidebar" },
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
            .insert(EngineTaskTable)
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
              judge: false,
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
              metadata: EngineTaskTable.metadata,
            })
            .from(EngineTaskTable)
            .where(eq(EngineTaskTable.id, taskID))
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
          },
          lint: ["bun", "run", "lint"],
        })
      },
    })
  })
})
