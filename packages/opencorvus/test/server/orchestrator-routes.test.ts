import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Bus } from "../../src/bus"
import { parseSSE } from "../../src/control-plane/sse"
import { Database, eq } from "../../src/storage/db"
import { type ExecutorAdapter } from "../../src/executor/contracts"
import { CheckRunner } from "../../src/evaluator/service"
import { ExecutorRegistry } from "../../src/executor/registry"
import { OpencodeExecutor } from "../../src/executor/opencode"
import { Identifier } from "../../src/id/id"
import { Event as OrchestratorEvent } from "../../src/orchestrator/model"
import { OrchestratorGoalRunTable, OrchestratorRunTable, OrchestratorTaskTable } from "../../src/orchestrator/orchestrator.sql"
import { OrchestratorProtocol } from "../../src/orchestrator/protocol"
import { OrchestratorService, PlannerFailureError } from "../../src/orchestrator/service"
import { Preference } from "../../src/preference"
import { Instance } from "../../src/project/instance"
import { PlannerService } from "../../src/planner/service"
import { SpecService } from "../../src/spec/service"
import { ProtocolStore } from "../../src/protocol/store"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

async function waitFor<T>(label: string, read: () => Promise<T> | T, predicate: (value: T) => boolean, attempts = 120, delayMs = 25) {
  let last!: T
  for (let index = 0; index < attempts; index += 1) {
    last = await read()
    if (predicate(last)) return last
    await Bun.sleep(delayMs)
  }
  throw new Error(`Timed out waiting for ${label}`)
}

async function waitForTaskRow(taskID: string, predicate: (task: { status: string; metadata?: Record<string, unknown>; session_id?: string | null }) => boolean) {
  return waitFor(`task ${taskID}`, () =>
    Database.use((db) =>
      db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, taskID)).get(),
    ), (task) => !!task && predicate(task))
}

async function waitForRunRow(taskID: string, predicate: (run: { status: string; phase?: string | null; executor?: string; metadata?: Record<string, unknown> }) => boolean) {
  return waitFor(`run for task ${taskID}`, () =>
    Database.use((db) =>
      db.select().from(OrchestratorRunTable).where(eq(OrchestratorRunTable.task_id, taskID)).get(),
    ), (run) => !!run && predicate(run))
}

async function waitForGoalRunRow(taskID: string, predicate: (goalRun: { status: string; metadata?: Record<string, unknown> }) => boolean) {
  return waitFor(`goal run for task ${taskID}`, () =>
    Database.use((db) =>
      db.select().from(OrchestratorGoalRunTable).where(eq(OrchestratorGoalRunTable.task_id, taskID)).get(),
    ), (goalRun) => !!goalRun && predicate(goalRun))
}

async function waitForProgress(taskID: string, predicate: (progress: Awaited<ReturnType<typeof OrchestratorService.getProgress>>) => boolean) {
  return waitFor(`progress for task ${taskID}`, () => OrchestratorService.getProgress(taskID), predicate)
}

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
    requirements: goals(input).map((goal, index) => ({
      id: `req_${index + 1}`,
      title: goal.description,
      description: goal.description,
      priority: goal.priority,
      acceptance: [goal.criteria],
      evidence_refs: [],
      metadata: { ...(goal.metadata ?? {}), check_selector: ["build"] },
    })),
    assumptions: [],
    risks: [],
    clarifications: [],
    evidence_sources: [],
    unresolved_questions: [],
  }))
  spyOn(SpecService, "rewrite").mockImplementation(async (input) => ({
    summary: `Spec rewrite: ${input.title}`,
    content: `# Scope\n\n${input.request}`,
    requirements: goals(input).map((goal, index) => ({
      id: `req_${index + 1}`,
      title: goal.description,
      description: goal.description,
      priority: goal.priority,
      acceptance: [goal.criteria],
      evidence_refs: [],
      metadata: { ...(goal.metadata ?? {}), check_selector: ["build"] },
    })),
    assumptions: [],
    risks: [input.rewriteContext.failureAnalysis.summary],
    clarifications: [],
    evidence_sources: [],
    unresolved_questions: [],
  }))
  spyOn(CheckRunner, "analyzeDelivery").mockImplementation(async (input) => {
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
      waves: goals(input).map((goal, index) => ({
        title: `Wave ${index + 1}`,
        objective: goal.description,
        goal_indices: [index],
        owned_paths: [`src/goal-${index + 1}.ts`],
      })),
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
      waves: goals(input).map((goal, index) => ({
        title: `Wave ${index + 1}`,
        objective: goal.description,
        goal_indices: [index],
        owned_paths: [`src/goal-${index + 1}.ts`],
      })),
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
    spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
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

        const task = await waitForTaskRow(json.task_id, (row) => row.status !== "planning")
        expect(["queued", "running", "accepted", "failed", "completed", "evaluating"]).toContain(task.status)
        expect(task?.metadata?.checks).toBeDefined()

        const run = await waitForRunRow(json.task_id, (row) => row.status === "accepted" || row.status === "running")
        const goalRun = await waitForGoalRunRow(json.task_id, (row) => typeof row.metadata?.queue_task_id === "string")
        expect(["accepted", "running"]).toContain(run.status)
        expect(goalRun?.metadata?.queue_task_id).toBeTruthy()
      },
    })
  })

  test("POST /task is idempotent when request id is reused", async () => {
    await using tmp = await tmpdir({ git: true })
    spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
      sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const requestID = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const first = await app.request("/task", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            project: Instance.project.id,
            requestID,
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
            requestID,
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
            .where(eq(OrchestratorTaskTable.request_id, requestID))
            .all(),
        )
        expect(tasks.length).toBe(1)
        expect(tasks[0]?.request_id).toBe(requestID)
        await waitForRunRow(firstBody.task_id, () => true)
      },
    })
  })

  test("DELETE /task/:id removes the task and its root session", async () => {
    await using tmp = await tmpdir({ git: true })
    spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
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
        const task = await waitForTaskRow(task_id, (row) => !!row.session_id)

        expect(task?.session_id).toBeTruthy()

        const removed = await app.request(`/task/${task_id}`, {
          method: "DELETE",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(removed.status).toBe(200)
        expect(await removed.json()).toBe(true)

        const nextTask = Database.use((db) =>
          db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, task_id)).get(),
        )
        const nextSession = task?.session_id
          ? await Session.get(task.session_id).catch(() => null)
          : null

        expect(nextTask).toBeUndefined()
        expect(nextSession).toBeNull()
      },
    })
  })

  test("POST /task accepts request id header for idempotency", async () => {
    await using tmp = await tmpdir({ git: true })
    spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
      sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const requestID = `req-header-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const first = await app.request("/task", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
            "x-opencorvus-request-id": requestID,
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
            "x-opencorvus-request-id": requestID,
          },
          body: JSON.stringify({
            project: Instance.project.id,
            request: "implement feature x",
          }),
        })

        const firstBody = (await first.json()) as { task_id: string }
        const secondBody = (await second.json()) as { task_id: string }
        expect(secondBody.task_id).toBe(firstBody.task_id)
        const tasks = Database.use((db) =>
          db
            .select()
            .from(OrchestratorTaskTable)
            .where(eq(OrchestratorTaskTable.request_id, requestID))
            .all(),
        )
        expect(tasks).toHaveLength(1)
      },
    })
  })

  test("POST /task/:id/message stores preference update", async () => {
    await using tmp = await tmpdir({ git: true })
    spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
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
  })

  test("GET /task/:id/brief returns compiled assistant brief", async () => {
    await using tmp = await tmpdir({ git: true })
    spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
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
  })

  test("POST /task/:id/message records free-form preference text as a note", async () => {
    await using tmp = await tmpdir({ git: true })
    spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
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
  })

  test("GET /task/:id/board returns unified board projection", async () => {
    await using tmp = await tmpdir({ git: true })
    spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
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
  })

  test("PATCH /task/:id/budget updates the task run budget", async () => {
    await using tmp = await tmpdir({ git: true })
    spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
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
        const response = await app.request(`/task/${task_id}/budget`, {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            budget: {
              maxRuns: 2,
              maxReplans: 0,
              maxEvaluations: 3,
              maxWallTimeMs: 180000,
            },
          }),
        })

        expect(response.status).toBe(200)
        const body = (await response.json()) as { budget?: { maxRuns?: number; maxReplans?: number; maxEvaluations?: number; maxWallTimeMs?: number } }
        expect(body.budget).toEqual({
          maxRuns: 2,
          maxReplans: 0,
          maxEvaluations: 3,
          maxWallTimeMs: 180000,
        })
      },
    })
  })

  test("GET /task/:id/board returns 304 when the board tag is unchanged", async () => {
    await using tmp = await tmpdir({ git: true })
    spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
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
  })

  test("GET /task/:id/board forwards sync=1 to board reads", async () => {
    await using tmp = await tmpdir({ git: true })
    spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
      sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))
    const getBoard = OrchestratorService.getBoard
    const getBoardTag = OrchestratorService.getBoardTag
    const boardCalls: Array<boolean> = []
    const tagCalls: Array<boolean> = []
    const boardSpy = spyOn(OrchestratorService, "getBoard").mockImplementation((taskID, input) => {
      boardCalls.push(input?.sync !== false)
      return getBoard(taskID, input)
    })
    const tagSpy = spyOn(OrchestratorService, "getBoardTag").mockImplementation((taskID, input) => {
      tagCalls.push(input?.sync !== false)
      return getBoardTag(taskID, input)
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
          }),
        })
        const { task_id } = (await created.json()) as { task_id: string }
        const response = await app.request(`/task/${task_id}/board?sync=1`, {
          method: "GET",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(response.status).toBe(200)
        expect(tagCalls).toContain(true)
        expect(boardCalls).toContain(true)
      },
    })

    boardSpy.mockRestore()
    tagSpy.mockRestore()
  })

  test("GET /task/:id/board exposes protocol sync metadata", async () => {
    await using tmp = await tmpdir({ git: true })
    spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
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
            request: "surface board sequence metadata",
          }),
        })

        expect(created.status).toBe(202)
        const { task_id } = (await created.json()) as { task_id: string }
        const before = ProtocolStore.latestTaskSequence(task_id)
        await ProtocolStore.appendEvent({
          kind: "event",
          type: "orchestrator.task.updated",
          aggregate: "task",
          aggregate_id: task_id,
          task_id,
          source: "test.routes.board",
          payload: {
            taskID: task_id,
            summary: "Task updated for board metadata",
          },
        })
        const response = await app.request(`/task/${task_id}/board?sync=1`, {
          method: "GET",
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })

        expect(response.status).toBe(200)
        const board = await response.json() as { snapshotVersion?: string; lastSequence?: number }
        expect(typeof board.snapshotVersion).toBe("string")
        expect(board.lastSequence).toBeGreaterThan(before)
      },
    })
  })

  test("GET /task/:id/events replays persisted protocol events after the requested sequence", async () => {
    await using tmp = await tmpdir({ git: true })
    spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
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
            request: "resume protocol events from a cursor",
          }),
        })

        expect(created.status).toBe(202)
        const { task_id } = (await created.json()) as { task_id: string }
        const before = ProtocolStore.latestTaskSequence(task_id)
        await ProtocolStore.appendEvent({
          kind: "event",
          type: "orchestrator.task.updated",
          aggregate: "task",
          aggregate_id: task_id,
          task_id,
          source: "test.routes.events",
          payload: {
            taskID: task_id,
            summary: "Event one",
          },
        })
        await ProtocolStore.appendEvent({
          kind: "event",
          type: "orchestrator.run.updated",
          aggregate: "task",
          aggregate_id: task_id,
          task_id,
          source: "test.routes.events",
          payload: {
            taskID: task_id,
            summary: "Event two",
          },
        })

        const stop = new AbortController()
        const response = await app.request(`/task/${task_id}/events?after=${before}`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
          signal: stop.signal,
        })

        expect(response.status).toBe(200)
        expect(response.body).toBeDefined()

        try {
          const replayed = await new Promise<{ type?: string; sequence?: number }>((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error("timed out waiting for replayed task event"))
            }, 3000)

            void parseSSE(response.body!, stop.signal, (event) => {
              const next = event as { type?: string; sequence?: number }
              if (next.sequence !== before + 1) return
              clearTimeout(timeout)
              resolve(next)
              stop.abort()
            }).catch((error) => {
              clearTimeout(timeout)
              reject(error)
            })
          })

          expect(replayed).toEqual(expect.objectContaining({
            type: "task.updated",
            sequence: before + 1,
          }))
        } finally {
          stop.abort()
        }
      },
    })
  })

  test("GET /task/:id/events forwards session message events for the task", async () => {
    await using tmp = await tmpdir({ git: true })
    spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
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
        const task = await waitForTaskRow(task_id, (row) => !!row.session_id)

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
          setTimeout(() => {
            void Bus.publish(MessageV2.Event.PartDelta, {
              sessionID: task!.session_id!,
              messageID: "msg_1",
              partID: "part_1",
              field: "text",
              delta: "Hello from task session",
            })
          }, 25)
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error("timed out waiting for task session event"))
            }, 3000)

            void parseSSE(response.body!, stop.signal, (event) => {
              seen.push(event)
              const next = event as { type?: string }
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
  })

  test("GET /task/:id/events forwards agent stream events for the task", async () => {
    await using tmp = await tmpdir({ git: true })
    spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
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
            request: "stream planner output",
          }),
        })

        expect(created.status).toBe(202)
        const { task_id } = (await created.json()) as { task_id: string }
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
          setTimeout(() => {
            void OrchestratorProtocol.emit(OrchestratorEvent.AgentUpdated, {
              taskID: task_id,
              stage: "planner",
              kind: "message_delta",
              id: "planner-live",
              text: "Build homepage",
              summary: "Build homepage",
            }, { source: "test.agent.updated" })
          }, 25)
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error("timed out waiting for agent task event"))
            }, 3000)

            void parseSSE(response.body!, stop.signal, (event) => {
              seen.push(event)
              const next = event as {
                type?: string
                payload?: { stage?: string; kind?: string; text?: string; taskID?: string }
              }
              if (next.type !== "agent.updated") return
              if (next.payload?.stage !== "planner") return
              if (next.payload?.kind !== "message_delta") return
              if (next.payload?.text !== "Build homepage") return
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
          type: "agent.updated",
          payload: expect.objectContaining({
            taskID: task_id,
            stage: "planner",
            kind: "message_delta",
            text: "Build homepage",
          }),
        }))
      },
    })
  })

  test("GET /task/:id/board includes api user-scoped preferences after message", async () => {
    await using tmp = await tmpdir({ git: true })
    spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
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
  })

  test("GET /tasks returns project-level aggregation", async () => {
    await using tmp = await tmpdir({ git: true })
    spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
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
  })

  test("GET /global/tasks returns tasks across projects with directories", async () => {
    await using first = await tmpdir({ git: true })
    await using second = await tmpdir({ git: true })
    const prefix = `global-task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
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
    await insert(first.path, `${prefix}-one`, now - 10)
    await insert(second.path, `${prefix}-two`, now)

    const response = await Server.App().request(`/global/tasks?q=${prefix}`, {
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
    expect(body.tasks.map((item) => item.task.title)).toEqual([`${prefix}-two`, `${prefix}-one`])
    expect(body.tasks.map((item) => item.task.directory)).toEqual([second.path, first.path])
    expect(body.tasks.map((item) => item.project?.worktree)).toEqual([second.path, first.path])
  })

  test("POST /task/:id/retry queues a deterministic retry run", async () => {
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
      summary: "executor finished",
      diffs: [],
    })
    spyOn(CheckRunner, "evaluate").mockResolvedValue({
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
        await waitForProgress(task_id, (progress) => progress.task.status === "failed")

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
  })

  test("POST /task/:id/replan queues a replanned run", async () => {
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
      summary: "executor finished",
      diffs: [],
    })
    spyOn(CheckRunner, "evaluate").mockResolvedValue({
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
        await waitForProgress(task_id, (progress) => progress.task.status === "failed")

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
  })

  test("PATCH and DELETE preference routes mutate board data", async () => {
    await using tmp = await tmpdir({ git: true })
    spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
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
  })

  test("PATCH and DELETE goal routes are no longer exposed", async () => {
    await using tmp = await tmpdir({ git: true })
    spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
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
        await waitForProgress(task_id, (progress) => progress.goals.some((goal) => goal.description === "Initial goal"))

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
        const run = await waitForRunRow(body.task_id, (row) => row.executor === "codex")
        expect(run?.executor).toBe("codex")
      },
    })

    await waitFor("custom executor submit", () => calls.length, (count) => count === 1)
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

  test("POST /task returns 202 and persists a failed task when planner compilation fails in background bootstrap", async () => {
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

        expect(response.status).toBe(202)
        const body = (await response.json()) as { task_id: string }
        const task = await waitForTaskRow(body.task_id, (row) => row.status === "failed")
        expect(task?.status).toBe("failed")
        expect(String((task as { error?: string }).error ?? "")).toContain("planner agent failed")
      },
    })
  })
})
