import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Database } from "../../src/storage/db"
import { ProjectTable } from "../../src/project/project.sql"
import { EngineArtifactTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { describeTask, renderTaskDescription } from "../../src/engine/describe"
import { recordToolExecuteError } from "../../src/engine/persist"
import { createDecisionLog } from "../../src/decision-log"
import { Instance } from "../../src/project/instance"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

/**
 * Regression for the engine-wedge-2026-04-30 fix
 * (specs/engine-stream-error-wedge-2026-04-30.md). Pre-fix,
 * `recordOrchestratorStreamError` wrote `orchestrator-stream-error`
 * artifacts but `describe.ts` never read them, so the orchestrator had no
 * evidence on its next wake after a transient HTTP 401
 * (_session-r2-glm5.out 14:47:25).
 *
 * The fix surfaces those artifacts through the describe layer so the
 * orchestrator LLM sees them on its next wake and decides retry /
 * restart_from_stage / fail itself. This test seeds the artifacts
 * directly and asserts the projection + rendering.
 */

let projectID = ""
let taskID = ""
let stamp = ""

function seedTask(taskStartedMs: number) {
  Database.transaction((db) => {
    db.insert(ProjectTable)
      .values({
        id: projectID,
        worktree: process.cwd(),
        name: "stream-error describe test",
        sandboxes: [],
        time_created: taskStartedMs,
        time_updated: taskStartedMs,
      })
      .run()
    db.insert(EngineTaskTable)
      .values({
        id: taskID,
        project_id: projectID,
        source: "test",
        title: "stream-error describe",
        request: "test",
        kind: "workflow",
        priority: "normal",
        time_created: taskStartedMs,
        time_updated: taskStartedMs,
        time_started: taskStartedMs,
      })
      .run()
  })
}

function seedStreamError(input: {
  artifactID: string
  timeCreated: number
  reason: string
  errorName?: string
  sessionID?: string
}) {
  Database.transaction((db) => {
    db.insert(EngineArtifactTable)
      .values({
        id: input.artifactID,
        task_id: taskID,
        run_id: null,
        kind: "orchestrator-stream-error",
        label: "orchestrator-stream-error",
        payload: {
          reason: input.reason,
          errorName: input.errorName ?? null,
          sessionID: input.sessionID ?? null,
          now: input.timeCreated,
        },
        time_created: input.timeCreated,
        time_updated: input.timeCreated,
      })
      .run()
  })
}

beforeEach(async () => {
  await resetDatabase()
  stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  projectID = `proj_swe_${stamp}`
  taskID = `tsk_swe_${stamp}`
})

afterEach(async () => {
  await resetDatabase()
})

describe("describeTask.recent_stream_failures", () => {
  test("absent when no stream-error artifacts exist", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        seedTask(Date.now())
        const desc = await describeTask(taskID)
        expect(desc.recent_stream_failures).toBeUndefined()
      },
    })
  })

  test("populated newest-first when artifacts exist after task start", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskStart = Date.now()
        seedTask(taskStart)
        seedStreamError({
          artifactID: `art_a_${stamp}`,
          timeCreated: taskStart + 1000,
          reason: "APIError: Provider alibaba-coding-plan returned HTTP 401: invalid access token",
          errorName: "APIError",
          sessionID: "ses_test_a",
        })
        seedStreamError({
          artifactID: `art_b_${stamp}`,
          timeCreated: taskStart + 2000,
          reason: "AbortError: stream idle > 180000ms",
          errorName: "AbortError",
        })
        const desc = await describeTask(taskID)
        expect(desc.recent_stream_failures).toBeDefined()
        expect(desc.recent_stream_failures!.length).toBe(2)
        // Newest first.
        expect(desc.recent_stream_failures![0]!.artifact_id).toBe(`art_b_${stamp}`)
        expect(desc.recent_stream_failures![0]!.error_name).toBe("AbortError")
        expect(desc.recent_stream_failures![1]!.artifact_id).toBe(`art_a_${stamp}`)
        expect(desc.recent_stream_failures![1]!.error_name).toBe("APIError")
        expect(desc.recent_stream_failures![1]!.session_id).toBe("ses_test_a")
        expect(desc.recent_stream_failures![1]!.reason).toContain("HTTP 401")
      },
    })
  })

  test("artifacts older than task.time_started are excluded", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskStart = Date.now()
        seedTask(taskStart)
        seedStreamError({
          artifactID: `art_old_${stamp}`,
          timeCreated: taskStart - 5000,
          reason: "stale failure from a previous task lifecycle",
        })
        const desc = await describeTask(taskID)
        expect(desc.recent_stream_failures).toBeUndefined()
      },
    })
  })

  test("more than the cap collapses to the 5 newest", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskStart = Date.now()
        seedTask(taskStart)
        for (let i = 0; i < 8; i++) {
          seedStreamError({
            artifactID: `art_${i}_${stamp}`,
            timeCreated: taskStart + 1000 + i,
            reason: `failure ${i}`,
          })
        }
        const desc = await describeTask(taskID)
        expect(desc.recent_stream_failures!.length).toBe(5)
        // Newest five are 7..3, in that order.
        expect(desc.recent_stream_failures![0]!.artifact_id).toBe(`art_7_${stamp}`)
        expect(desc.recent_stream_failures![4]!.artifact_id).toBe(`art_3_${stamp}`)
      },
    })
  })
})

describe("renderTaskDescription — stream failures section", () => {
  test("section appears with reason text + decision-aid wording", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskStart = Date.now()
        seedTask(taskStart)
        seedStreamError({
          artifactID: `art_render_${stamp}`,
          timeCreated: taskStart + 100,
          reason: "APIError: Provider alibaba-coding-plan returned HTTP 401: invalid access token",
          errorName: "APIError",
        })
        const desc = await describeTask(taskID)
        const md = renderTaskDescription(desc)
        expect(md).toContain("Recent orchestrator stream failures")
        expect(md).toContain("[APIError]")
        expect(md).toContain("HTTP 401")
        // Decision-aid wording — without these the LLM may not recognise
        // the section as actionable history.
        expect(md).toContain("retry_task")
        expect(md).toContain("restart_from_stage")
        expect(md).toContain("fail_task")
      },
    })
  })

  test("section absent when no stream errors recorded since task start", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        seedTask(Date.now())
        const desc = await describeTask(taskID)
        const md = renderTaskDescription(desc)
        expect(md).not.toContain("Recent orchestrator stream failures")
      },
    })
  })
})

describe("describeTask.recent_agent_failures", () => {
  test("decision_log agent_error entries are projected newest-first", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskStart = Date.now()
        seedTask(taskStart)
        const log = createDecisionLog(taskID)
        log.append({
          phase: "agent_error",
          key: "build_session_error",
          value: "AgentRunError: [build] APIError: Provider returned HTTP 429",
          reason: "model-visible agent failure; session=ses_a; kind=build",
        })
        await new Promise((resolve) => setTimeout(resolve, 2))
        log.append({
          phase: "agent_error",
          goalID: "goal_visible_error",
          key: "frontend_design_session_error",
          value: "AgentRunError: [frontend_design] upstream socket closed",
          reason: "model-visible agent failure; session=ses_b; kind=frontend_design",
        })

        const desc = await describeTask(taskID)
        expect(desc.recent_agent_failures).toBeDefined()
        expect(desc.recent_agent_failures!.length).toBe(2)
        expect(desc.recent_agent_failures![0]!.key).toBe("frontend_design_session_error")
        expect(desc.recent_agent_failures![0]!.goal_id).toBe("goal_visible_error")
        expect(desc.recent_agent_failures![1]!.key).toBe("build_session_error")
        expect(desc.recent_agent_failures![1]!.reason).toContain("HTTP 429")
      },
    })
  })

  test("rendered section tells the orchestrator not to treat repeated request text as a fresh start", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        seedTask(Date.now())
        createDecisionLog(taskID).append({
          phase: "agent_error",
          key: "build_session_error",
          value:
            "Agent session failed before producing a successful result.\nerror=AgentRunError: [build] APIError: Provider returned HTTP 429",
          reason: "model-visible agent failure; session=ses_build; kind=build",
        })

        const md = renderTaskDescription(await describeTask(taskID))
        expect(md).toContain("Recent agent session failures")
        expect(md).toContain("HTTP 429")
        expect(md).toContain("retry the same work")
        expect(md).toContain("Do not infer a fresh task start")
      },
    })
  })
})

describe("describeTask.recent_tool_execute_failures", () => {
  test("recordToolExecuteError writes an artifact projected by describe", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskStart = Date.now()
        seedTask(taskStart)
        recordToolExecuteError({
          taskID,
          sessionID: "ses_tool_error",
          messageID: "msg_tool_error",
          partID: "part_tool_error",
          toolName: "register_goal",
          callID: "call_tool_error",
          input: [],
          failure: {
            kind: "tool-input-invalid",
            name: "InvalidToolInputError",
            message: "Expected object, received array",
            originSite: "session.processor.tool-error",
            classification: "tool-input-invalid",
          },
          now: taskStart + 100,
        })

        const desc = await describeTask(taskID)
        expect(desc.recent_tool_execute_failures).toHaveLength(1)
        expect(desc.recent_tool_execute_failures![0]!.tool_name).toBe("register_goal")
        expect(desc.recent_tool_execute_failures![0]!.reason).toContain("Expected object, received array")

        const md = renderTaskDescription(desc)
        expect(md).toContain("Recent tool execution failures")
        expect(md).toContain("register_goal")
        expect(md).toContain("Expected object, received array")
      },
    })
  })
})
