import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { ClaudeCodeExecutor } from "../../src/executor/claude-code"
import { CodexExecutor } from "../../src/executor/codex"
import { ExecutorRegistry } from "../../src/executor/registry"
import { OpencodeExecutor } from "../../src/executor/opencode"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Database, eq } from "../../src/storage/db"
import { OrchestratorRunTable } from "../../src/orchestrator/orchestrator.sql"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("executor e2e", () => {
  afterEach(async () => {
    mock.restore()
    ExecutorRegistry.reset()
    await resetDatabase()
  })

  test("opencode completes a task through HTTP flow", async () => {
    await using tmp = await tmpdir({ git: true })
    spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
      sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))
    spyOn(OpencodeExecutor, "status").mockResolvedValue({
      queueTaskID: Identifier.ascending("task"),
      status: "completed",
      error: null,
    })
    spyOn(OpencodeExecutor, "delivery").mockResolvedValue({
      summary: "opencode delivery",
      diffs: [],
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const taskID = await createTask(app, tmp.path, {
          request: "complete task via opencode",
          checks: {
            verify_cmd: [`"${process.execPath}" -e "process.exit(0)"`],
          },
        })
        const progress = await waitForCompleted(app, tmp.path, taskID)

        expect(progress.task.status).toBe("completed")
        expect(progress.run?.executor).toBe("opencode")
        expect(progress.delivery?.summary).toBe("opencode delivery")
      },
    })
  })

  test("codex completes a task through HTTP flow", async () => {
    await using tmp = await tmpdir({ git: true })
    ExecutorRegistry.registerCoding(
      "codex",
      CodexExecutor.create({
        responses: {
          create() {
            return feed([
              { type: "response.created", response: { id: "resp_codex" } },
              { type: "response.output_text.delta", delta: "codex" },
              { type: "response.completed", response: { id: "resp_codex", output_text: "codex delivery" } },
            ])
          },
          async cancel() {},
        },
      }),
      {
        model: "gpt-5.2-codex",
        cwd: tmp.path,
      },
    )

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const taskID = await createTask(app, tmp.path, {
          request: "complete task via codex",
          executor: "codex",
          checks: {
            verify_cmd: [`"${process.execPath}" -e "process.exit(0)"`],
          },
        })
        const progress = await waitForCompleted(app, tmp.path, taskID)
        const run = Database.use((db) =>
          db.select().from(OrchestratorRunTable).where(eq(OrchestratorRunTable.task_id, taskID)).get(),
        )

        expect(progress.task.status).toBe("completed")
        expect(progress.run?.executor).toBe("codex")
        expect(progress.delivery?.summary).toBe("codex delivery")
        expect(run?.executor_ref?.queue_task_id).toBeTruthy()
      },
    })
  })

  test("claude-code completes a task through HTTP flow", async () => {
    await using tmp = await tmpdir({ git: true })
    ExecutorRegistry.registerCoding(
      "claude-code",
      ClaudeCodeExecutor.create(() =>
        feed([
          { type: "system", subtype: "init", session_id: "claude_session" },
          {
            type: "stream_event",
            event: {
              type: "content_block_delta",
              index: 0,
              delta: { type: "text_delta", text: "claude" },
            },
          },
          {
            type: "result",
            subtype: "success",
            session_id: "claude_session",
            result: "claude delivery",
            total_cost_usd: 0.02,
            num_turns: 1,
          },
        ]),
      ),
      {
        model: "claude-sonnet-4-5",
        cwd: tmp.path,
      },
    )

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const taskID = await createTask(app, tmp.path, {
          request: "complete task via claude code",
          executor: "claude-code",
          checks: {
            verify_cmd: [`"${process.execPath}" -e "process.exit(0)"`],
          },
        })
        const progress = await waitForCompleted(app, tmp.path, taskID)

        expect(progress.task.status).toBe("completed")
        expect(progress.run?.executor).toBe("claude-code")
        expect(progress.delivery?.summary).toBe("claude delivery")
      },
    })
  })
})

async function createTask(
  app: ReturnType<typeof Server.App>,
  directory: string,
  body: Record<string, unknown>,
) {
  const response = await app.request("/task", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-opencorvus-directory": directory,
    },
    body: JSON.stringify({
      project: Instance.project.id,
      ...body,
    }),
  })
  expect(response.status).toBe(202)
  const json = (await response.json()) as { task_id: string }
  return json.task_id
}

async function waitForCompleted(app: ReturnType<typeof Server.App>, directory: string, taskID: string) {
  for (let index = 0; index < 30; index++) {
    const response = await app.request(`/task/${taskID}/progress`, {
      headers: {
        "x-opencorvus-directory": directory,
      },
    })
    expect(response.status).toBe(200)
    const json = await response.json() as {
      task: { status: string }
      run?: { executor: string }
      delivery?: { summary: string }
    }
    if (json.task.status === "completed") return json
    await Bun.sleep(50)
  }
  throw new Error(`task did not complete: ${taskID}`)
}

function feed(items: unknown[]): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item
    },
  }
}
