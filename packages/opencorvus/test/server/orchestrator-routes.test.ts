import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Bus } from "../../src/bus"
import { parseSSE } from "../../src/control-plane/sse"
import { Database, eq } from "../../src/storage/db"
import { type ExecutorAdapter } from "../../src/executor/compat"
import { EvaluatorService } from "../../src/evaluator/service"
import { ExecutorRegistry } from "../../src/executor/registry"
import { OpencodeExecutor } from "../../src/executor/opencode"
import { Identifier } from "../../src/id/id"
import { OrchestratorGoalRunTable, OrchestratorRunTable, OrchestratorTaskTable } from "../../src/orchestrator/orchestrator.sql"
import { PlannerFailureError } from "../../src/orchestrator/service"
import { Preference } from "../../src/preference"
import { Instance } from "../../src/project/instance"
import { PlannerService } from "../../src/planner/service"
import { SpecService } from "../../src/spec/service"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

function mockLLM() {
  const goals = (input: { request: string; goals?: Array<{ description: string; criteria: string; priority?: "blocking" | "advisory"; metadata?: Record<string, unknown> }>; spec?: { goals?: Array<{ description: string; criteria: string; priority?: "blocking" | "advisory"; metadata?: Record<string, unknown> }> } }) =>
    (input.goals ?? input.spec?.goals ?? [{ description: input.request, criteria: "Task completed successfully", priority: "blocking" as const }]).map((goal) => ({
      description: goal.description,
      criteria: goal.criteria,
      priority: goal.priority ?? ("blocking" as const),
      metadata: goal.metadata ?? {},
    }))
  spyOn(SpecService, "initial").mockImplementation(async (input) => ({
    summary: `Spec: ${input.title}`,
    content: `# Scope\n\n${input.request}`,
    goals: goals(input),
    assumptions: [],
    risks: [],
    clarifications: [],
    spec_items: [{
      title: input.title,
      description: input.request,
      priority: "blocking" as const,
      check_selector: ["spec_check"],
    }],
    evidence_sources: [],
    unresolved_questions: [],
  }))
  spyOn(SpecService, "rewrite").mockImplementation(async (input) => ({
    summary: `Spec rewrite: ${input.title}`,
    content: `# Scope\n\n${input.request}`,
    goals: goals(input),
    assumptions: [],
    risks: [input.rewriteContext.failureAnalysis.summary],
    clarifications: [],
    spec_items: [{
      title: input.title,
      description: input.request,
      priority: "blocking" as const,
      check_selector: ["spec_check"],
    }],
    evidence_sources: [],
    unresolved_questions: [],
  }))
  spyOn(EvaluatorService, "analyzeDelivery").mockImplementation(async (input) => {
    const allPassed = input.checkResults.every((c) => c.status === "passed")
    return {
      verdict: allPassed ? "accepted" : "rejected",
      classification: "evaluation",
      summary: allPassed ? "All checks passed" : "Some checks failed",
      goal_statuses: input.goals.map((_, i) => ({
        goal_index: i,
        status: allPassed ? ("passed" as const) : ("failed" as const),
        evidence: allPassed ? "Checks passed" : "Checks failed",
        reasoning: allPassed ? "All checks passed" : "Some checks failed",
      })),
      replan_guidance: allPassed ? null : {
        root_cause: "Checks failed",
        what_failed: "Automated verification",
        suggested_strategy: "Fix the failing checks",
        avoid_approaches: [],
      },
    }
  })
  spyOn(PlannerService, "initial").mockImplementation(async (input) => ({
    summary: `Plan: ${input.title}`,
    prompt: `Execute: ${input.request}`,
    goals: goals(input),
    metadata: {
      strategy: "initial" as const,
      steps: ["1. Execute the task"],
      planner: {
        role: "headless_compiler" as const,
        quality: "compiled" as const,
        source: "planner_agent" as const,
        clarification_source: "none" as const,
      },
    },
  }))
  spyOn(PlannerService, "replan").mockImplementation(async (input) => ({
    summary: `Replan: ${input.title}`,
    prompt: `Retry: ${input.request}\n\nPrevious failure: ${input.failureSummary}`,
    goals: goals(input),
    metadata: {
      strategy: "replan" as const,
      steps: ["1. Retry the task"],
      failure_summary: input.failureSummary,
      previous_plan_id: input.previousPlanID,
      planner: {
        role: "headless_compiler" as const,
        quality: "compiled" as const,
        source: "planner_agent" as const,
        clarification_source: "none" as const,
      },
    },
  }))
}

describe("orchestrator routes", () => {
  beforeEach(() => {
    mockLLM()
  })
  afterEach(async () => {
    mock.restore()
    ExecutorRegistry.reset()
    await resetDatabase()
  })

  test("POST /task returns task_id and dispatches a run", async () => {
    await using tmp = await tmpdir({ git: true })
    const submit = spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
      sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const response = await app.request("/task", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            project: Instance.project.id,
            request: "implement feature x",
            checks: {
              verify_cmd: [`"${process.execPath}" -e "process.exit(0)"`],
            },
          }),
        })

        expect(response.status).toBe(202)
        const json = (await response.json()) as { task_id: string }
        expect(typeof json.task_id).toBe("string")

        const task = Database.use((db) =>
          db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, json.task_id)).get(),
        )
        expect(task?.status).toBe("running")
        expect(task?.metadata?.checks).toBeDefined()

        const run = Database.use((db) =>
          db.select().from(OrchestratorRunTable).where(eq(OrchestratorRunTable.task_id, json.task_id)).get(),
        )
        const goalRun = Database.use((db) =>
          db.select().from(OrchestratorGoalRunTable).where(eq(OrchestratorGoalRunTable.task_id, json.task_id)).get(),
        )
        expect(run?.status).toBe("accepted")
        expect(goalRun?.metadata?.queue_task_id).toBeTruthy()
      },
    })

    expect(submit).toHaveBeenCalledTimes(1)
  })

  test("POST /task is idempotent when request id is reused", async () => {
    await using tmp = await tmpdir({ git: true })
    const submit = spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
      sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const first = await app.request("/task", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            project: Instance.project.id,
            requestID: "req-123",
            request: "implement feature x",
          }),
        })
        const second = await app.request("/task", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            project: Instance.project.id,
            requestID: "req-123",
            request: "implement feature x",
          }),
        })

        const firstBody = (await first.json()) as { task_id: string }
        const secondBody = (await second.json()) as { task_id: string }
        expect(first.status).toBe(202)
        expect(second.status).toBe(202)
        expect(secondBody.task_id).toBe(firstBody.task_id)

        const tasks = Database.use((db) =>
          db
            .select()
            .from(OrchestratorTaskTable)
            .where(eq(OrchestratorTaskTable.request_id, "req-123"))
            .all(),
        )
        expect(tasks.length).toBe(1)
        expect(tasks[0]?.request_id).toBe("req-123")
      },
    })

    expect(submit).toHaveBeenCalledTimes(1)
  })

  test("POST /task accepts request id header for idempotency", async () => {
    await using tmp = await tmpdir({ git: true })
    const submit = spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
      sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const first = await app.request("/task", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
            "x-opencorvus-request-id": "req-header-1",
          },
          body: JSON.stringify({
            project: Instance.project.id,
            request: "implement feature x",
          }),
        })
        const second = await app.request("/task", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
            "x-opencorvus-request-id": "req-header-1",
          },
          body: JSON.stringify({
            project: Instance.project.id,
            request: "implement feature x",
          }),
        })

        const firstBody = (await first.json()) as { task_id: string }
        const secondBody = (await second.json()) as { task_id: string }
        expect(secondBody.task_id).toBe(firstBody.task_id)
      },
    })

    expect(submit).toHaveBeenCalledTimes(1)
  })

  test("POST /task/:id/message stores preference update", async () => {
    await using tmp = await tmpdir({ git: true })
    const submit = spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
      sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const created = await app.request("/task", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            project: Instance.project.id,
            request: "implement feature x",
            metadata: {
              slack: {
                user: "U123",
              },
            },
          }),
        })
        const { task_id } = (await created.json()) as { task_id: string }
        const response = await app.request(`/task/${task_id}/message`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            text: "/pref style=concise",
            source: "slack",
            user_id: "U123",
          }),
        })
        expect(response.status).toBe(200)
        const body = (await response.json()) as { kind: string; message: string }
        expect(body.kind).toBe("preference")
        expect(body.message).toContain("Preference saved")
      },
    })

    expect(submit).toHaveBeenCalledTimes(1)
  })

  test("GET /task/:id/brief returns compiled assistant brief", async () => {
    await using tmp = await tmpdir({ git: true })
    const submit = spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
      sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))
    spyOn(OpencodeExecutor, "status").mockResolvedValue({
      queueTaskID: Identifier.ascending("task"),
      status: "running",
      error: null,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const created = await app.request("/task", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            project: Instance.project.id,
            request: "implement feature x",
            metadata: {
              slack: {
                user: "U123",
              },
            },
          }),
        })
        const { task_id } = (await created.json()) as { task_id: string }
        await app.request(`/task/${task_id}/message`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            text: "/pref lockfile_policy=avoid_changes",
            source: "slack",
            user_id: "U123",
          }),
        })
        const response = await app.request(`/task/${task_id}/brief`, {
          method: "GET",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(response.status).toBe(200)
        const body = (await response.json()) as { content: string }
        expect(body.content).toContain("Global preferences:")
        expect(body.content).toContain("lockfile_policy: avoid_changes")
      },
    })

    expect(submit).toHaveBeenCalledTimes(1)
  })

  test("POST /task/:id/message records free-form preference text as a note", async () => {
    await using tmp = await tmpdir({ git: true })
    const submit = spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
      sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))
    spyOn(OpencodeExecutor, "status").mockResolvedValue({
      queueTaskID: Identifier.ascending("task"),
      status: "running",
      error: null,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        process.env.OPENCORVUS_WORKBENCH_LLM = "0"
        const app = Server.App()
        const created = await app.request("/task", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            project: Instance.project.id,
            request: "implement feature x",
            metadata: {
              slack: {
                user: "U999",
              },
            },
          }),
        })
        const { task_id } = (await created.json()) as { task_id: string }
        const response = await app.request(`/task/${task_id}/message`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            text: "Please keep updates concise and avoid changing lockfiles unless absolutely necessary.",
            source: "slack",
            user_id: "U999",
          }),
        })
        expect(response.status).toBe(200)
        const body = (await response.json()) as { kind: string; message: string }
        expect(body.kind).toBe("note")
        expect(body.message).toContain("Intent analysis failed")
        const brief = await app.request(`/task/${task_id}/brief`, {
          method: "GET",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        const briefBody = (await brief.json()) as { content: string }
        expect(briefBody.content).not.toContain("style: concise")
        expect(briefBody.content).not.toContain("lockfile_policy: avoid_changes")
        expect(briefBody.content).toContain("Please keep updates concise")
        delete process.env.OPENCORVUS_WORKBENCH_LLM
      },
    })

    expect(submit).toHaveBeenCalledTimes(1)
  })

  test("GET /task/:id/board returns unified board projection", async () => {
    await using tmp = await tmpdir({ git: true })
    const submit = spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
      sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))
    spyOn(OpencodeExecutor, "status").mockResolvedValue({
      queueTaskID: Identifier.ascending("task"),
      status: "running",
      error: null,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        process.env.OPENCORVUS_WORKBENCH_LLM = "0"
        const app = Server.App()
        const created = await app.request("/task", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            project: Instance.project.id,
            request: "implement feature x",
            metadata: {
              slack: {
                user: "U777",
              },
            },
          }),
        })
        const { task_id } = (await created.json()) as { task_id: string }
        await app.request(`/task/${task_id}/message`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            text: "Please keep updates concise and avoid changing lockfiles unless absolutely necessary.",
            source: "slack",
            user_id: "U777",
          }),
        })
        const response = await app.request(`/task/${task_id}/board`, {
          method: "GET",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(response.status).toBe(200)
        const body = (await response.json()) as { lanes: Array<{ id: string; cards: unknown[] }>; brief: { content: string } }
        expect(body.lanes.some((lane) => lane.id === "preferences" && lane.cards.length > 0)).toBe(false)
        expect(body.brief.content).not.toContain("lockfile_policy: avoid_changes")
        delete process.env.OPENCORVUS_WORKBENCH_LLM
      },
    })

    expect(submit).toHaveBeenCalledTimes(1)
  })

  test("GET /task/:id/board returns 304 when the board tag is unchanged", async () => {
    await using tmp = await tmpdir({ git: true })
    const submit = spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
      sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const created = await app.request("/task", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            project: Instance.project.id,
            request: "implement feature x",
          }),
        })
        const { task_id } = (await created.json()) as { task_id: string }
        const first = await app.request(`/task/${task_id}/board?sync=0`, {
          method: "GET",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        const etag = first.headers.get("etag")

        expect(first.status).toBe(200)
        expect(etag).toBeTruthy()

        const second = await app.request(`/task/${task_id}/board?sync=0`, {
          method: "GET",
          headers: {
            "x-opencorvus-directory": tmp.path,
            "if-none-match": etag!,
          },
        })

        expect(second.status).toBe(304)
        expect(second.headers.get("etag")).toBe(etag)
      },
    })

    expect(submit).toHaveBeenCalledTimes(1)
  })

  test("GET /task/:id/events forwards session message events for the task", async () => {
    await using tmp = await tmpdir({ git: true })
    const submit = spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
      sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const created = await app.request("/task", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            project: Instance.project.id,
            request: "stream task session updates",
          }),
        })

        expect(created.status).toBe(202)
        const { task_id } = (await created.json()) as { task_id: string }
        const task = Database.use((db) =>
          db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, task_id)).get(),
        )

        expect(task?.session_id).toBeTruthy()

        const stop = new AbortController()
        const response = await app.request(`/task/${task_id}/events`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
          signal: stop.signal,
        })

        expect(response.status).toBe(200)
        expect(response.body).toBeDefined()

        const seen: unknown[] = []
        try {
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error("timed out waiting for task session event"))
            }, 3000)

            void parseSSE(response.body!, stop.signal, (event) => {
              seen.push(event)
              const next = event as { type?: string }
              if (next.type === "task.connected") {
                void Bus.publish(MessageV2.Event.PartDelta, {
                  sessionID: task!.session_id!,
                  messageID: "msg_1",
                  partID: "part_1",
                  field: "text",
                  delta: "Hello from task session",
                }).catch((error) => {
                  clearTimeout(timeout)
                  reject(error)
                })
                return
              }
              if (next.type !== "message.part.delta") return
              clearTimeout(timeout)
              resolve()
            }).catch((error) => {
              clearTimeout(timeout)
              reject(error)
            })
          })
        } finally {
          stop.abort()
        }

        expect(seen).toContainEqual(expect.objectContaining({
          type: "message.part.delta",
          payload: expect.objectContaining({
            sessionID: task!.session_id,
            delta: "Hello from task session",
          }),
        }))
      },
    })

    expect(submit).toHaveBeenCalledTimes(1)
  })

  test("GET /task/:id/board includes api user-scoped preferences after message", async () => {
    await using tmp = await tmpdir({ git: true })
    const submit = spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
      sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))
    spyOn(OpencodeExecutor, "status").mockResolvedValue({
      queueTaskID: Identifier.ascending("task"),
      status: "running",
      error: null,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        process.env.OPENCORVUS_WORKBENCH_LLM = "0"
        const app = Server.App()
        const created = await app.request("/task", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            project: Instance.project.id,
            request: "implement feature x",
          }),
        })
        const { task_id } = (await created.json()) as { task_id: string }
        await app.request(`/task/${task_id}/message`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            text: "Please keep updates concise and avoid changing lockfiles unless absolutely necessary.",
            source: "api",
            user_id: "U-API",
          }),
        })
        const response = await app.request(`/task/${task_id}/board`, {
          method: "GET",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(response.status).toBe(200)
        const body = (await response.json()) as { lanes: Array<{ id: string; cards: Array<{ title: string }> }>; brief: { content: string } }
        expect(body.lanes.some((lane) => lane.id === "preferences" && lane.cards.some((card) => card.title === "style"))).toBe(false)
        expect(body.brief.content).not.toContain("lockfile_policy: avoid_changes")
        delete process.env.OPENCORVUS_WORKBENCH_LLM
      },
    })

    expect(submit).toHaveBeenCalledTimes(1)
  })

  test("GET /tasks returns project-level aggregation", async () => {
    await using tmp = await tmpdir({ git: true })
    const submit = spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
      sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        await app.request("/task", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            project: Instance.project.id,
            request: "first task",
          }),
        })
        await app.request("/task", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            project: Instance.project.id,
            request: "second task",
          }),
        })

        const response = await app.request("/tasks", {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(response.status).toBe(200)
        const body = (await response.json()) as {
          summary: { total_tasks: number; open_tasks: number }
          tasks: Array<{ task: { id: string; request: string } }>
        }
        expect(body.summary.total_tasks).toBe(2)
        expect(body.summary.open_tasks).toBe(2)
        expect(body.tasks.length).toBe(2)
      },
    })

    expect(submit).toHaveBeenCalledTimes(2)
  })

  test("GET /global/tasks returns tasks across projects with directories", async () => {
    await using first = await tmpdir({ git: true })
    await using second = await tmpdir({ git: true })
    const insert = async (dir: string, title: string, time: number) =>
      Instance.provide({
        directory: dir,
        async fn() {
          const session = await Session.create({ title })
          Database.use((db) =>
            db.insert(OrchestratorTaskTable).values({
              id: Identifier.ascending("task"),
              project_id: Instance.project.id,
              session_id: session.id,
              source: "api",
              title,
              request: title,
              status: "queued",
              priority: "normal",
              time_created: time,
              time_updated: time,
            }).run(),
          )
        },
      })

    const now = Date.now()
    await insert(first.path, "global-task-one", now - 10)
    await insert(second.path, "global-task-two", now)

    const response = await Server.App().request("/global/tasks?q=global-task", {
      headers: {
        "x-opencorvus-directory": first.path,
      },
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      summary: { total_tasks: number }
      tasks: Array<{ task: { title: string; directory?: string }; project?: { worktree: string } | null }>
    }

    expect(body.summary.total_tasks).toBe(2)
    expect(body.tasks.map((item) => item.task.title)).toEqual(["global-task-two", "global-task-one"])
    expect(body.tasks.map((item) => item.task.directory)).toEqual([second.path, first.path])
    expect(body.tasks.map((item) => item.project?.worktree)).toEqual([second.path, first.path])
  })

  test("POST /task/:id/retry queues a deterministic retry run", async () => {
    await using tmp = await tmpdir({ git: true })
    const submit = spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
      sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))
    spyOn(OpencodeExecutor, "status").mockResolvedValue({
      queueTaskID: Identifier.ascending("task"),
      status: "completed",
      error: null,
    })
    spyOn(OpencodeExecutor, "delivery").mockResolvedValue({
      summary: "executor finished",
      diffs: [],
    })
    spyOn(EvaluatorService, "evaluate").mockResolvedValue({
      status: "failed",
      verdict: "rejected",
      summary: "Some checks failed",
      checks: [{
        name: "verify_cmd",
        status: "failed",
        evidence: "exit 1",
      }],
      artifacts: [],
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const created = await app.request("/task", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            project: Instance.project.id,
            request: "update the landing page hero section copy",
            budget: {
              maxRuns: 1,
              maxReplans: 0,
            },
            checks: {
              verify_cmd: [`"${process.execPath}" -e "process.exit(1)"`],
            },
          }),
        })
        const { task_id } = (await created.json()) as { task_id: string }
        const progress = await app.request(`/task/${task_id}/progress`, {
          method: "GET",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(progress.status).toBe(200)

        const response = await app.request(`/task/${task_id}/retry`, {
          method: "POST",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(response.status).toBe(200)
        const body = (await response.json()) as { status: string }
        expect(body.status).toBe("accepted")
      },
    })

    expect(submit).toHaveBeenCalledTimes(2)
  })

  test("POST /task/:id/replan queues a replanned run", async () => {
    await using tmp = await tmpdir({ git: true })
    const submit = spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
      sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))
    spyOn(OpencodeExecutor, "status").mockResolvedValue({
      queueTaskID: Identifier.ascending("task"),
      status: "completed",
      error: null,
    })
    spyOn(OpencodeExecutor, "delivery").mockResolvedValue({
      summary: "executor finished",
      diffs: [],
    })
    spyOn(EvaluatorService, "evaluate").mockResolvedValue({
      status: "failed",
      verdict: "rejected",
      summary: "Some checks failed",
      checks: [{
        name: "verify_cmd",
        status: "failed",
        evidence: "exit 1",
      }],
      artifacts: [],
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const created = await app.request("/task", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            project: Instance.project.id,
            request: "update the landing page hero section copy",
            budget: {
              maxRuns: 1,
              maxReplans: 0,
            },
            checks: {
              verify_cmd: [`"${process.execPath}" -e "process.exit(1)"`],
            },
          }),
        })
        const { task_id } = (await created.json()) as { task_id: string }
        const progress = await app.request(`/task/${task_id}/progress`, {
          method: "GET",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(progress.status).toBe(200)

        const response = await app.request(`/task/${task_id}/replan`, {
          method: "POST",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(response.status).toBe(200)
        const body = (await response.json()) as { status: string; phase: string }
        expect(body.status).toBe("accepted")
        expect(body.phase).toBe("replan")
      },
    })

    expect(submit).toHaveBeenCalledTimes(2)
  })

  test("PATCH and DELETE preference routes mutate board data", async () => {
    await using tmp = await tmpdir({ git: true })
    const submit = spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
      sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))
    spyOn(OpencodeExecutor, "status").mockResolvedValue({
      queueTaskID: Identifier.ascending("task"),
      status: "running",
      error: null,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        process.env.OPENCORVUS_WORKBENCH_LLM = "0"
        const app = Server.App()
        const created = await app.request("/task", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            project: Instance.project.id,
            request: "implement feature x",
          }),
        })
        const { task_id } = (await created.json()) as { task_id: string }
        await app.request(`/task/${task_id}/message`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            text: "/pref style=concise",
          }),
        })
        const pref = Preference.manageable({
          projectID: Instance.project.id,
        }).find((item) => item.key === "style")
        expect(pref?.key).toBe("style")

        const updated = await app.request(`/preference/${pref!.id}`, {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            key: "style",
            value: "minimal_diff",
          }),
        })
        expect(updated.status).toBe(200)

        const afterUpdate = await app.request(`/task/${task_id}/brief`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        const updatedBody = (await afterUpdate.json()) as { content: string }
        expect(updatedBody.content).toContain("style: minimal_diff")

        const removed = await app.request(`/preference/${pref!.id}`, {
          method: "DELETE",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(removed.status).toBe(200)

        const afterDelete = await app.request(`/task/${task_id}/brief`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        const deletedBody = (await afterDelete.json()) as { content: string }
        expect(deletedBody.content).not.toContain("style: minimal_diff")
        delete process.env.OPENCORVUS_WORKBENCH_LLM
      },
    })

    expect(submit).toHaveBeenCalledTimes(1)
  })

  test("PATCH and DELETE goal routes are no longer exposed", async () => {
    await using tmp = await tmpdir({ git: true })
    const submit = spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
      sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))
    spyOn(OpencodeExecutor, "status").mockResolvedValue({
      queueTaskID: Identifier.ascending("task"),
      status: "running",
      error: null,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const created = await app.request("/task", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            project: Instance.project.id,
            request: "implement feature x",
            goals: [
              {
                description: "Initial goal",
                criteria: "Initial criteria",
              },
            ],
          }),
        })
        const { task_id } = (await created.json()) as { task_id: string }

        const before = await app.request(`/task/${task_id}/board`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        const beforeBody = (await before.json()) as { lanes: Array<{ id: string; cards: Array<{ id: string; title: string; detail?: string }> }> }
        const goal = beforeBody.lanes.find((lane) => lane.id === "goals")?.cards[0]
        expect(goal?.title).toBe("Initial goal")

        const updated = await app.request(`/goal/${goal!.id}`, {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            description: "Updated goal",
            criteria: "Updated criteria",
          }),
        })
        expect(updated.status).toBe(404)

        const removed = await app.request(`/goal/${goal!.id}`, {
          method: "DELETE",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(removed.status).toBe(404)
      },
    })

    expect(submit).toHaveBeenCalledTimes(1)
  })

  test("POST /task accepts a registered custom executor", async () => {
    await using tmp = await tmpdir({ git: true })
    const calls: string[] = []
    const codex: ExecutorAdapter = {
      capabilities() {
        return {
          submit: true,
          status: true,
          abort: true,
          delivery: true,
          resume: true,
          events: true,
        }
      },
      async submit(input: { sessionID: string; prompt: string; priority?: "high" | "normal" | "low" }) {
        calls.push(input.prompt)
        return {
          sessionID: input.sessionID,
          queueTaskID: Identifier.ascending("task"),
        }
      },
      async status(queueTaskID: string) {
        return {
          queueTaskID,
          status: "queued",
          error: null,
        }
      },
      async abort() {
        return true
      },
      async delivery() {
        return {
          summary: "done",
          diffs: [],
        }
      },
      async resume(input: { sessionID: string; message: string; priority?: "high" | "normal" | "low" }) {
        return this.submit({
          sessionID: input.sessionID,
          prompt: input.message,
          priority: input.priority,
        })
      },
      async *events() {},
    }
    ExecutorRegistry.register("codex", codex)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const response = await app.request("/task", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            project: Instance.project.id,
            executor: "codex",
            request: "implement feature y",
          }),
        })

        expect(response.status).toBe(202)
        const body = (await response.json()) as { task_id: string }
        const run = Database.use((db) =>
          db.select().from(OrchestratorRunTable).where(eq(OrchestratorRunTable.task_id, body.task_id)).get(),
        )
        expect(run?.executor).toBe("codex")
      },
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain("implement feature y")
  })

  test("POST /task returns 400 when executor is not registered", async () => {
    await using tmp = await tmpdir({ git: true })
    // Prevent auto-discovery from finding real executors on this machine
    const { ExecutorBootstrap } = await import("../../src/executor/bootstrap")
    spyOn(ExecutorBootstrap, "autoRegister").mockResolvedValue({
      codex: { available: false },
      "claude-code": { available: false },
    } as never)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const response = await app.request("/task", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            project: Instance.project.id,
            executor: "codex",
            request: "implement feature z",
          }),
        })

        expect(response.status).toBe(400)
        expect(await response.text()).toContain("executor not configured: codex")
      },
    })
  })

  test("POST /task returns 503 when planner compilation fails", async () => {
    await using tmp = await tmpdir({ git: true })
    mock.restore()
    mockLLM()
    spyOn(PlannerService, "initial").mockRejectedValue(new PlannerFailureError("planner agent failed"))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const response = await app.request("/task", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            project: Instance.project.id,
            request: "implement feature x",
          }),
        })

        expect(response.status).toBe(503)
        expect(await response.text()).toContain("planner agent failed")

        const task = Database.use((db) =>
          db
            .select()
            .from(OrchestratorTaskTable)
            .where(eq(OrchestratorTaskTable.request, "implement feature x"))
            .orderBy(OrchestratorTaskTable.time_created)
            .all()
            .filter((item) => item.status === "failed")
            .at(-1),
        )
        expect(task?.status).toBe("failed")
        expect(task?.error).toContain("planner agent failed")
      },
    })
  })
})
