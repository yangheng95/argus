import { afterEach, describe, expect, test } from "bun:test"
import {
  createOrchestratorTools,
  ORCHESTRATOR_WAIT_MAX_MS,
  ORCHESTRATOR_WAIT_MIN_MS,
  ORCHESTRATOR_WAIT_RECOMMENDED_MS,
} from "../../src/orchestrator/tools"
import { Agent } from "../../src/agent/agent"
import { AgentToolPool } from "../../src/agent/tool-pool-contract"
import { ToolRegistry } from "../../src/tool/registry"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { ORCHESTRATOR_DECISION_EFFECT_METADATA_KEY } from "../../src/orchestrator/stateful-tool-names"
import { executeWait, WaitToolParameters } from "../../src/tool/wait"
import { Database, eq } from "../../src/storage/db"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { resetDatabase } from "../fixture/db"
import { CronJobTable } from "../../src/scheduler/cron.sql"
import { Session } from "../../src/session"

/**
 * Orchestrator `wait` is a one-shot deliberate pause for a NAMED external
 * event. These tests pin the bounds and behavior that the prompt's
 * "do not poll" discipline relies on so future edits cannot silently
 * loosen them.
 *
 * Orchestrator wait-tool contract.
 */

afterEach(async () => {
  await resetDatabase()
})

function toolFixtureInput() {
  return {
    taskID: "tsk_orchestrator_wait_fixture",
    agentSessionID: "ses_orchestrator_wait_fixture",
  }
}

function uniqueToolFixtureInput() {
  const stamp = `${Date.now()}_${Math.random().toString(16).slice(2)}`
  return {
    taskID: `tsk_orchestrator_wait_${stamp}`,
    agentSessionID: `ses_orchestrator_wait_${stamp}`,
  }
}

function seedToolFixtureTask(taskID: string) {
  const now = Date.now()
  Database.use((db) => {
    db.insert(EngineTaskTable)
      .values({
        id: taskID,
        project_id: Instance.project.id,
        source: "test",
        title: "Orchestrator wait fixture",
        request: "Wait for a named external event",
        kind: "workflow",
        priority: "normal",
        time_created: now,
        time_updated: now,
        time_started: now,
      } as any)
      .run()
  })
}

async function withSeededWaitTools(
  input: Partial<ReturnType<typeof toolFixtureInput>> & { signal?: AbortSignal },
  fn: (
    tools: ReturnType<typeof createOrchestratorTools>["tools"],
    fixture: ReturnType<typeof toolFixtureInput>,
  ) => Promise<void>,
) {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const fixture = {
        ...uniqueToolFixtureInput(),
        ...input,
      }
      seedToolFixtureTask(fixture.taskID)
      const { tools } = createOrchestratorTools(fixture)
      await fn(tools, fixture)
    },
  })
}

function toolOptions() {
  const stamp = `${Date.now()}_${Math.random().toString(16).slice(2)}`
  return {
    toolCallId: `cal_wait_${stamp}`,
    opencorvus: {
      sessionID: `ses_wait_${stamp}`,
      messageID: `msg_wait_${stamp}`,
      toolCallID: `cal_wait_${stamp}`,
      toolPartID: `prt_wait_${stamp}`,
    },
  } as any
}

function toolOutput(result: unknown): string {
  if (typeof result === "string") return result
  if (result && typeof result === "object") {
    const output = (result as Record<string, unknown>).output
    if (typeof output === "string") return output
  }
  return String(result ?? "")
}

function toolMetadata(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== "object") return {}
  const metadata = (result as Record<string, unknown>).metadata
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {}
}

describe("createOrchestratorTools — wait wiring", () => {
  test("uses a one second floor and a twenty minute recommendation and ceiling", () => {
    expect(ORCHESTRATOR_WAIT_MIN_MS).toBe(1_000)
    expect(ORCHESTRATOR_WAIT_RECOMMENDED_MS).toBe(1_200_000)
    expect(ORCHESTRATOR_WAIT_MAX_MS).toBe(1_200_000)
  })

  test("schema accepts the recommended twenty minute wait and rejects longer waits", () => {
    expect(
      WaitToolParameters.safeParse({
        duration_ms: ORCHESTRATOR_WAIT_RECOMMENDED_MS,
        reason: "external deployment propagation",
      }).success,
    ).toBe(true)
    expect(
      WaitToolParameters.safeParse({
        duration_ms: ORCHESTRATOR_WAIT_RECOMMENDED_MS + 1,
        reason: "external deployment propagation",
      }).success,
    ).toBe(false)
  })

  test("exposes a `wait` tool entry with the load-bearing duration and discipline phrases", () => {
    const { tools } = createOrchestratorTools(toolFixtureInput())
    expect(tools).toHaveProperty("wait")
    const wait = (tools as Record<string, { description?: string }>).wait
    // The description carries prompt-level discipline. These phrases are
    // load-bearing — the orchestrator-core prompt cross-references them to
    // forbid polling and steer the LLM away from substituting `wait` for
    // `question`, `fail_task`, or a real workflow decision from the refreshed
    // task snapshot.
    expect(wait.description).toMatch(/one-shot/i)
    expect(wait.description).toMatch(/nonblocking/i)
    expect(wait.description).toMatch(/durable cron wake/i)
    expect(wait.description).toMatch(/returns immediately/i)
    expect(wait.description).toMatch(/When executing a goal/)
    expect(wait.description).toMatch(/default to 1200000ms \(20 minutes\)/)
    expect(wait.description).toMatch(/1200000ms \(20 minutes\)/)
    expect(wait.description).toMatch(/repeated 60000ms \(60 second\) waits/)
    expect(wait.description).toMatch(/NOT a polling primitive/i)
    expect(wait.description).toMatch(/external event/i)
    expect(wait.description).toMatch(/question/)
    expect(wait.description).toMatch(/fail_task/)
    expect(wait.description).toMatch(/visible message/)
    expect(wait.description).not.toMatch(/read_context/)
  })

  test("mission and orchestrator agent tool surfaces expose wait", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const mission = await Agent.get("mission")
        const orchestrator = await Agent.get("orchestrator")
        expect(AgentToolPool.visibleToolIDs(mission?.tools).has("wait")).toBe(true)
        expect(AgentToolPool.visibleToolIDs(orchestrator?.tools).has("wait")).toBe(true)

        const missionTools = await ToolRegistry.tools({ providerID: "", modelID: "" }, mission)
        expect(missionTools.map((tool) => tool.id)).toContain("wait")
      },
    })
  })
})

describe("createOrchestratorTools — wait execute", () => {
  test("schedules a task cron wait and returns immediately", async () => {
    await withSeededWaitTools({}, async (tools, fixture) => {
      const requested = 1_200
      const startedAt = Date.now()
      const result = await (tools as any).wait.execute(
        { duration_ms: requested, reason: "external CI propagation" },
        toolOptions(),
      )
      const elapsed = Date.now() - startedAt
      const output = toolOutput(result)
      expect(elapsed).toBeLessThan(requested / 2)
      expect(output).toMatch(/^Scheduled nonblocking task wait/)
      expect(output).toContain("external CI propagation")
      expect(output).toContain("scheduled wake")
      expect(output).not.toMatch(/read_context/)
      expect(toolMetadata(result)[ORCHESTRATOR_DECISION_EFFECT_METADATA_KEY]).toBe("decision")
      const metadata = toolMetadata(result)
      expect(metadata.mode).toBe("task")
      expect(metadata.nonblocking).toBe(true)
      expect(metadata.elapsedMs).toBeUndefined()
      const row = Database.use((db) =>
        db.select().from(CronJobTable).where(eq(CronJobTable.task_id, fixture.taskID)).get(),
      )
      expect(row).toBeDefined()
      expect(row?.enabled).toBe(true)
      expect(row?.one_shot).toBe(true)
      expect(row?.prompt).toBe("external CI propagation")
      expect(row?.next_run ?? 0).toBeGreaterThanOrEqual(startedAt + requested)
      expect(row?.id).toBe(metadata.jobID)
    })
  })

  test("short-circuits when the abort signal is already aborted before invocation", async () => {
    const controller = new AbortController()
    controller.abort("pre-aborted")
    await withSeededWaitTools({ signal: controller.signal }, async (tools, fixture) => {
      const startedAt = Date.now()
      const result = await (tools as any).wait.execute(
        { duration_ms: 30_000, reason: "dev server warmup" },
        toolOptions(),
      )
      const elapsed = Date.now() - startedAt
      const output = toolOutput(result)
      expect(elapsed).toBeLessThan(500)
      expect(output).toMatch(/^wait was not scheduled/)
      expect(toolMetadata(result)[ORCHESTRATOR_DECISION_EFFECT_METADATA_KEY]).toBe("none")
      const row = Database.use((db) =>
        db.select().from(CronJobTable).where(eq(CronJobTable.task_id, fixture.taskID)).get(),
      )
      expect(row).toBeUndefined()
    })
  })

  test("non-task wait schedules a one-shot session cron instead of sleeping", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "assistant", title: "session wait fixture" })
        const requested = 1_200
        const startedAt = Date.now()
        const result = await executeWait({
          duration_ms: requested,
          reason: "remote webhook delivery",
          sessionID: session.id,
        })
        const elapsed = Date.now() - startedAt
        expect(elapsed).toBeLessThan(requested / 2)
        expect(result.mode).toBe("session")
        expect(result.aborted).toBe(false)
        expect(result.output).toMatch(/^Scheduled nonblocking session wait/)
        const row = Database.use((db) => db.select().from(CronJobTable).where(eq(CronJobTable.id, result.jobID!)).get())
        expect(row?.session_id).toBe(session.id)
        expect(row?.task_id).toBeNull()
        expect(row?.enabled).toBe(true)
        expect(row?.one_shot).toBe(true)
        expect(row?.prompt).toContain("remote webhook delivery")
        expect(row?.next_run ?? 0).toBeGreaterThanOrEqual(startedAt + requested)
      },
    })
  })
})
