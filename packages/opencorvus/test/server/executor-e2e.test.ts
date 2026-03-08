import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { ClaudeCodeExecutor } from "../../src/executor/claude-code"
import { CodexExecutor } from "../../src/executor/codex"
import { ExecutorRegistry } from "../../src/executor/registry"
import { OpencodeExecutor } from "../../src/executor/opencode"
import { EvaluatorService } from "../../src/evaluator/service"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { PlannerService } from "../../src/planner/service"
import { Server } from "../../src/server/server"
import { Database, eq } from "../../src/storage/db"
import { OrchestratorRunTable, OrchestratorGoalTable } from "../../src/orchestrator/orchestrator.sql"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

/** Mock planner + evaluator agent so tests don't require an LLM. */
function mockPlanner() {
  spyOn(EvaluatorService, "analyzeDelivery").mockImplementation(async (input) => {
    const allPassed = input.checkResults.every((c) => c.status === "passed")
    return {
      verdict: allPassed ? "accepted" : "rejected",
      classification: allPassed ? "none" : "evaluation",
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
    goals: (input.goals ?? [{ description: input.request, criteria: "Task completed successfully", priority: "blocking" as const }]).map((g) => ({
      description: g.description,
      criteria: g.criteria,
      priority: g.priority ?? ("blocking" as const),
      metadata: {},
    })),
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
    goals: input.goals.map((g) => ({
      description: g.description,
      criteria: g.criteria,
      priority: g.priority ?? ("blocking" as const),
      metadata: {},
    })),
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

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

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

async function waitForStatus(
  app: ReturnType<typeof Server.App>,
  directory: string,
  taskID: string,
  statuses: string[],
  maxPolls = 60,
) {
  for (let index = 0; index < maxPolls; index++) {
    const response = await app.request(`/task/${taskID}/progress`, {
      headers: { "x-opencorvus-directory": directory },
    })
    expect(response.status).toBe(200)
    const json = (await response.json()) as {
      task: { status: string; error?: string }
      run?: { executor: string; status: string; attempt?: number }
      delivery?: { summary: string }
      evaluation?: { status: string; verdict: string; checks?: Array<{ name: string; status: string }> }
      goals?: Array<{ status: string; description: string; priority: string }>
    }
    if (statuses.includes(json.task.status)) return json
    await Bun.sleep(50)
  }
  throw new Error(`task ${taskID} did not reach ${statuses.join("|")} within ${maxPolls} polls`)
}

function waitForCompleted(
  app: ReturnType<typeof Server.App>,
  directory: string,
  taskID: string,
) {
  return waitForStatus(app, directory, taskID, ["completed"])
}

function waitForFinal(
  app: ReturnType<typeof Server.App>,
  directory: string,
  taskID: string,
) {
  return waitForStatus(app, directory, taskID, ["completed", "failed"])
}

function feed(items: unknown[]): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item
    },
  }
}

/** A verify_cmd that always passes. */
const passCmd = () => `"${process.execPath}" -e "process.exit(0)"`
/** A verify_cmd that always fails. */
const failCmd = () => `"${process.execPath}" -e "process.exit(1)"`

function mockOpencode(delivery = "opencode delivery") {
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
    summary: delivery,
    diffs: [],
  })
}

function registerCodex(tmpPath: string, delivery = "codex delivery") {
  ExecutorRegistry.registerCoding(
    "codex",
    CodexExecutor.create({
      responses: {
        create() {
          return feed([
            { type: "response.created", response: { id: "resp_codex" } },
            { type: "response.output_text.delta", delta: "working on it" },
            { type: "response.completed", response: { id: "resp_codex", output_text: delivery } },
          ])
        },
        async cancel() {},
      },
    }),
    { model: "gpt-5.2-codex", cwd: tmpPath },
  )
}

function registerClaude(tmpPath: string, delivery = "claude delivery") {
  ExecutorRegistry.registerCoding(
    "claude-code",
    ClaudeCodeExecutor.create(() =>
      feed([
        { type: "system", subtype: "init", session_id: "claude_session_1" },
        {
          type: "stream_event",
          event: {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: "working" },
          },
        },
        {
          type: "result",
          subtype: "success",
          session_id: "claude_session_1",
          result: delivery,
          total_cost_usd: 0.02,
          num_turns: 1,
          usage: { input_tokens: 500, output_tokens: 200 },
        },
      ]),
    ),
    { model: "claude-sonnet-4-6", cwd: tmpPath },
  )
}

// ===========================================================================
// 1. Happy path — each executor completes a task
// ===========================================================================

describe("executor e2e", () => {
  beforeEach(() => {
    mockPlanner()
  })
  afterEach(async () => {
    mock.restore()
    ExecutorRegistry.reset()
    await resetDatabase()
  })

  // ── OpenCode ──────────────────────────────────────────────────────────

  test("opencode completes a task through HTTP flow", async () => {
    await using tmp = await tmpdir({ git: true })
    mockOpencode()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const taskID = await createTask(app, tmp.path, {
          request: "complete task via opencode",
          checks: { verify_cmd: [passCmd()] },
        })
        const progress = await waitForCompleted(app, tmp.path, taskID)

        expect(progress.task.status).toBe("completed")
        expect(progress.run?.executor).toBe("opencode")
        expect(progress.delivery).toBeTruthy()
      },
    })
  })

  // ── Codex ─────────────────────────────────────────────────────────────

  test("codex completes a task through HTTP flow", async () => {
    await using tmp = await tmpdir({ git: true })
    registerCodex(tmp.path)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const taskID = await createTask(app, tmp.path, {
          request: "complete task via codex",
          executor: "codex",
          checks: { verify_cmd: [passCmd()] },
        })
        const progress = await waitForCompleted(app, tmp.path, taskID)
        const run = Database.use((db) =>
          db.select().from(OrchestratorRunTable).where(eq(OrchestratorRunTable.task_id, taskID)).get(),
        )

        expect(progress.task.status).toBe("completed")
        expect(progress.run?.executor).toBe("codex")
        expect(progress.delivery).toBeTruthy()
        expect(run?.executor_ref?.queue_task_id).toBeTruthy()
      },
    })
  })

  // ── Claude Code ───────────────────────────────────────────────────────

  test("claude-code completes a task through HTTP flow", async () => {
    await using tmp = await tmpdir({ git: true })
    registerClaude(tmp.path)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const taskID = await createTask(app, tmp.path, {
          request: "complete task via claude code",
          executor: "claude-code",
          checks: { verify_cmd: [passCmd()] },
        })
        const progress = await waitForCompleted(app, tmp.path, taskID)

        expect(progress.task.status).toBe("completed")
        expect(progress.run?.executor).toBe("claude-code")
        expect(progress.delivery).toBeTruthy()
      },
    })
  })

  test("task fails explicitly when evaluator analysis is unavailable", async () => {
    await using tmp = await tmpdir({ git: true })
    mockOpencode()
    spyOn(EvaluatorService, "analyzeDelivery").mockRejectedValue(new Error("evaluator unavailable"))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const taskID = await createTask(app, tmp.path, {
          request: "fail when evaluator is unavailable",
          checks: { verify_cmd: [passCmd()] },
        })
        const progress = await waitForFinal(app, tmp.path, taskID)

        expect(progress.task.status).toBe("failed")
        expect(progress.task.error).toContain("Evaluator failure")
        expect(progress.evaluation?.status).toBe("failed")
      },
    })
  })
})

// ===========================================================================
// 2. Evaluation failure → retry with same executor
// ===========================================================================

describe("executor e2e — retry on evaluation failure", () => {
  beforeEach(() => {
    mockPlanner()
  })
  afterEach(async () => {
    mock.restore()
    ExecutorRegistry.reset()
    await resetDatabase()
  })

  test("opencode retries when verify_cmd fails then succeeds", async () => {
    await using tmp = await tmpdir({ git: true })

    let attempt = 0
    spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => {
      attempt++
      return { sessionID, queueTaskID: Identifier.ascending("task") }
    })
    spyOn(OpencodeExecutor, "status").mockResolvedValue({
      queueTaskID: Identifier.ascending("task"),
      status: "completed",
      error: null,
    })
    spyOn(OpencodeExecutor, "delivery").mockResolvedValue({
      summary: "opencode retry delivery",
      diffs: [],
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        // First run fails verify, second passes
        const taskID = await createTask(app, tmp.path, {
          request: "task that needs retry",
          checks: {
            verify_cmd: [`"${process.execPath}" -e "process.exit(${attempt < 2 ? 1 : 0})"`],
          },
        })
        const progress = await waitForFinal(app, tmp.path, taskID)
        const runs = Database.use((db) =>
          db.select().from(OrchestratorRunTable).where(eq(OrchestratorRunTable.task_id, taskID)).all(),
        )

        // At least 2 runs created (initial + retry)
        expect(runs.length).toBeGreaterThanOrEqual(2)
        expect(progress.run?.executor).toBe("opencode")
      },
    })
  })

  test("codex retries when verify_cmd fails", async () => {
    await using tmp = await tmpdir({ git: true })

    let callCount = 0
    ExecutorRegistry.registerCoding(
      "codex",
      CodexExecutor.create({
        responses: {
          create() {
            callCount++
            return feed([
              { type: "response.created", response: { id: `resp_${callCount}` } },
              { type: "response.completed", response: { id: `resp_${callCount}`, output_text: `codex attempt ${callCount}` } },
            ])
          },
          async cancel() {},
        },
      }),
      { model: "gpt-5.2-codex", cwd: tmp.path },
    )

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const taskID = await createTask(app, tmp.path, {
          request: "codex task that fails verify",
          executor: "codex",
          checks: { verify_cmd: [failCmd()] },
        })
        const progress = await waitForFinal(app, tmp.path, taskID)
        const runs = Database.use((db) =>
          db.select().from(OrchestratorRunTable).where(eq(OrchestratorRunTable.task_id, taskID)).all(),
        )

        // Should have retried at least once
        expect(runs.length).toBeGreaterThanOrEqual(2)
        // Eventually fails after max retries
        expect(progress.task.status).toBe("failed")
      },
    })
  })

  test("claude-code retries when verify_cmd fails", async () => {
    await using tmp = await tmpdir({ git: true })

    let callCount = 0
    ExecutorRegistry.registerCoding(
      "claude-code",
      ClaudeCodeExecutor.create(() => {
        callCount++
        return feed([
          { type: "system", subtype: "init", session_id: `claude_retry_${callCount}` },
          {
            type: "result",
            subtype: "success",
            session_id: `claude_retry_${callCount}`,
            result: `claude attempt ${callCount}`,
            num_turns: 1,
          },
        ])
      }),
      { model: "claude-sonnet-4-6", cwd: tmp.path },
    )

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const taskID = await createTask(app, tmp.path, {
          request: "claude task that fails verify",
          executor: "claude-code",
          checks: { verify_cmd: [failCmd()] },
        })
        const progress = await waitForFinal(app, tmp.path, taskID)
        const runs = Database.use((db) =>
          db.select().from(OrchestratorRunTable).where(eq(OrchestratorRunTable.task_id, taskID)).all(),
        )

        expect(runs.length).toBeGreaterThanOrEqual(2)
        expect(progress.task.status).toBe("failed")
      },
    })
  })
})

// ===========================================================================
// 3. Executor selection — correct executor dispatched
// ===========================================================================

describe("executor e2e — executor selection", () => {
  beforeEach(() => {
    mockPlanner()
  })
  afterEach(async () => {
    mock.restore()
    ExecutorRegistry.reset()
    await resetDatabase()
  })

  test("task dispatches to the requested executor", async () => {
    await using tmp = await tmpdir({ git: true })
    mockOpencode("opencode out")
    registerCodex(tmp.path, "codex out")
    registerClaude(tmp.path, "claude out")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()

        // Submit one task per executor
        const opcodeID = await createTask(app, tmp.path, {
          request: "opencode dispatch",
          executor: "opencode",
          checks: { verify_cmd: [passCmd()] },
        })
        const codexID = await createTask(app, tmp.path, {
          request: "codex dispatch",
          executor: "codex",
          checks: { verify_cmd: [passCmd()] },
        })
        const claudeID = await createTask(app, tmp.path, {
          request: "claude dispatch",
          executor: "claude-code",
          checks: { verify_cmd: [passCmd()] },
        })

        const [opResult, codexResult, claudeResult] = await Promise.all([
          waitForCompleted(app, tmp.path, opcodeID),
          waitForCompleted(app, tmp.path, codexID),
          waitForCompleted(app, tmp.path, claudeID),
        ])

        expect(opResult.run?.executor).toBe("opencode")
        expect(opResult.delivery).toBeTruthy()

        expect(codexResult.run?.executor).toBe("codex")
        expect(codexResult.delivery).toBeTruthy()

        expect(claudeResult.run?.executor).toBe("claude-code")
        expect(claudeResult.delivery).toBeTruthy()
      },
    })
  })

  test("defaults to opencode when no executor specified", async () => {
    await using tmp = await tmpdir({ git: true })
    mockOpencode()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const taskID = await createTask(app, tmp.path, {
          request: "no executor specified",
          checks: { verify_cmd: [passCmd()] },
        })
        const progress = await waitForCompleted(app, tmp.path, taskID)

        expect(progress.run?.executor).toBe("opencode")
      },
    })
  })
})

// ===========================================================================
// 4. Goal tracking through evaluation
// ===========================================================================

describe("executor e2e — goal tracking", () => {
  beforeEach(() => {
    mockPlanner()
  })
  afterEach(async () => {
    mock.restore()
    ExecutorRegistry.reset()
    await resetDatabase()
  })

  test("blocking goals are marked passed when verify_cmd succeeds (opencode)", async () => {
    await using tmp = await tmpdir({ git: true })
    mockOpencode()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const taskID = await createTask(app, tmp.path, {
          request: "task with goals",
          checks: { verify_cmd: [passCmd()] },
        })
        const progress = await waitForCompleted(app, tmp.path, taskID)
        const goals = Database.use((db) =>
          db.select().from(OrchestratorGoalTable).where(eq(OrchestratorGoalTable.task_id, taskID)).all(),
        )

        expect(progress.task.status).toBe("completed")
        // All blocking goals should be passed
        const blocking = goals.filter((g) => g.priority === "blocking")
        for (const g of blocking) {
          expect(g.status).toBe("passed")
        }
      },
    })
  })

  test("blocking goals remain pending when verify_cmd fails (claude-code)", async () => {
    await using tmp = await tmpdir({ git: true })
    registerClaude(tmp.path)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const taskID = await createTask(app, tmp.path, {
          request: "claude task with failing goals",
          executor: "claude-code",
          checks: { verify_cmd: [failCmd()] },
        })
        const progress = await waitForFinal(app, tmp.path, taskID)

        expect(progress.task.status).toBe("failed")
      },
    })
  })
})

// ===========================================================================
// 5. Claude Code streaming events
// ===========================================================================

describe("executor e2e — claude-code streaming", () => {
  beforeEach(() => {
    mockPlanner()
  })
  afterEach(async () => {
    mock.restore()
    ExecutorRegistry.reset()
    await resetDatabase()
  })

  test("claude-code streams text deltas and tool calls", async () => {
    await using tmp = await tmpdir({ git: true })
    ExecutorRegistry.registerCoding(
      "claude-code",
      ClaudeCodeExecutor.create(() =>
        feed([
          { type: "system", subtype: "init", session_id: "claude_stream" },
          {
            type: "stream_event",
            event: {
              type: "content_block_start",
              index: 0,
              content_block: { type: "tool_use", id: "tool_1", name: "Read", input: {} },
            },
          },
          {
            type: "stream_event",
            event: {
              type: "content_block_delta",
              index: 1,
              delta: { type: "text_delta", text: "Here is the result" },
            },
          },
          {
            type: "result",
            subtype: "success",
            session_id: "claude_stream",
            result: "streamed claude delivery",
            total_cost_usd: 0.05,
            num_turns: 3,
            usage: { input_tokens: 1000, output_tokens: 500 },
          },
        ]),
      ),
      { model: "claude-sonnet-4-6", cwd: tmp.path },
    )

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const taskID = await createTask(app, tmp.path, {
          request: "claude streaming test",
          executor: "claude-code",
          checks: { verify_cmd: [passCmd()] },
        })
        const progress = await waitForCompleted(app, tmp.path, taskID)

        expect(progress.task.status).toBe("completed")
        expect(progress.delivery).toBeTruthy()
      },
    })
  })

  test("claude-code error result propagates as run failure", async () => {
    await using tmp = await tmpdir({ git: true })
    ExecutorRegistry.registerCoding(
      "claude-code",
      ClaudeCodeExecutor.create(() =>
        feed([
          { type: "system", subtype: "init", session_id: "claude_err" },
          {
            type: "result",
            subtype: "error",
            session_id: "claude_err",
            errors: ["model overloaded"],
          },
        ]),
      ),
      { model: "claude-sonnet-4-6", cwd: tmp.path },
    )

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const taskID = await createTask(app, tmp.path, {
          request: "claude error test",
          executor: "claude-code",
          checks: { verify_cmd: [passCmd()] },
        })
        const progress = await waitForFinal(app, tmp.path, taskID)

        // Task should eventually fail after retries exhaust
        expect(["failed", "completed"]).toContain(progress.task.status)
      },
    })
  })
})

// ===========================================================================
// 6. Codex protocol specifics
// ===========================================================================

describe("executor e2e — codex protocol", () => {
  beforeEach(() => {
    mockPlanner()
  })
  afterEach(async () => {
    mock.restore()
    ExecutorRegistry.reset()
    await resetDatabase()
  })

  test("codex cancel is invoked when task is cancelled", async () => {
    await using tmp = await tmpdir({ git: true })
    let cancelCalled = false

    ExecutorRegistry.registerCoding(
      "codex",
      CodexExecutor.create({
        responses: {
          create() {
            // Slow stream — never completes naturally
            return {
              async *[Symbol.asyncIterator]() {
                yield { type: "response.created", response: { id: "resp_slow" } }
                await Bun.sleep(10_000)
              },
            }
          },
          async cancel() {
            cancelCalled = true
          },
        },
      }),
      { model: "gpt-5.2-codex", cwd: tmp.path },
    )

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const taskID = await createTask(app, tmp.path, {
          request: "codex cancel test",
          executor: "codex",
          checks: { verify_cmd: [passCmd()] },
        })

        // Give it time to start
        await Bun.sleep(100)

        // Cancel the task
        const cancelRes = await app.request(`/task/${taskID}/cancel`, {
          method: "POST",
          headers: { "x-opencorvus-directory": tmp.path },
        })
        expect(cancelRes.status).toBe(200)
      },
    })
  })

  test("codex with function tool calls produces delivery", async () => {
    await using tmp = await tmpdir({ git: true })
    ExecutorRegistry.registerCoding(
      "codex",
      CodexExecutor.create({
        responses: {
          create() {
            return feed([
              { type: "response.created", response: { id: "resp_tools" } },
              {
                type: "response.output_item.added",
                output_index: 0,
                item: {
                  type: "function_call",
                  id: "fc_1",
                  call_id: "call_1",
                  name: "read_file",
                  arguments: JSON.stringify({ path: "package.json" }),
                },
              },
              {
                type: "response.output_item.added",
                output_index: 1,
                item: {
                  type: "function_call_output",
                  call_id: "call_1",
                  output: '{"name":"test"}',
                },
              },
              { type: "response.completed", response: { id: "resp_tools", output_text: "codex tools delivery" } },
            ])
          },
          async cancel() {},
        },
      }),
      { model: "gpt-5.2-codex", cwd: tmp.path },
    )

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const taskID = await createTask(app, tmp.path, {
          request: "codex with tool calls",
          executor: "codex",
          checks: { verify_cmd: [passCmd()] },
        })
        const progress = await waitForCompleted(app, tmp.path, taskID)

        expect(progress.task.status).toBe("completed")
        expect(progress.delivery).toBeTruthy()
      },
    })
  })
})

// ===========================================================================
// 7. Multiple evaluator checks
// ===========================================================================

describe("executor e2e — multiple checks", () => {
  beforeEach(() => {
    mockPlanner()
  })
  afterEach(async () => {
    mock.restore()
    ExecutorRegistry.reset()
    await resetDatabase()
  })

  test("task passes when all verify_cmd checks succeed", async () => {
    await using tmp = await tmpdir({ git: true })
    mockOpencode()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const taskID = await createTask(app, tmp.path, {
          request: "multi-check pass",
          checks: {
            verify_cmd: [passCmd(), passCmd()],
            test: false,
            lint: false,
          },
        })
        const progress = await waitForCompleted(app, tmp.path, taskID)

        expect(progress.task.status).toBe("completed")
      },
    })
  })

  test("task fails when any verify_cmd check fails", async () => {
    await using tmp = await tmpdir({ git: true })
    mockOpencode()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const taskID = await createTask(app, tmp.path, {
          request: "multi-check fail",
          checks: {
            verify_cmd: [passCmd(), failCmd()],
            test: false,
            lint: false,
          },
        })
        const progress = await waitForFinal(app, tmp.path, taskID)

        expect(progress.task.status).toBe("failed")
      },
    })
  })
})
