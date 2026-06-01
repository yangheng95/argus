import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import {
  DEFAULT_MISSION_BENCHMARK_REQUEST,
  DEFAULT_MISSION_VERIFY_CMD,
  MISSION_BENCHMARK_STAGES,
  evaluateMissionBenchmarkReport,
  missionStateMentionsTerminalTasks,
  missionTaskRows,
  terminalMissionTasks,
} from "../../script/benchmark/mission-scenario"

const repoRoot = path.resolve(import.meta.dir, "../../../..")
const scriptPath = path.join(repoRoot, "packages/opencorvus/script/benchmark/mission-benchmark.ts")

describe("mission benchmark scenario", () => {
  test("default request pins the simple investigation -> write project -> project test loop", () => {
    for (const stage of MISSION_BENCHMARK_STAGES) {
      expect(DEFAULT_MISSION_BENCHMARK_REQUEST).toContain(stage.requiredText)
    }
    expect(DEFAULT_MISSION_BENCHMARK_REQUEST).toContain("panel.create_task")
    expect(DEFAULT_MISSION_BENCHMARK_REQUEST).toContain("panel.query_task")
    expect(DEFAULT_MISSION_BENCHMARK_REQUEST).toContain("Do not edit files yourself")
    expect(DEFAULT_MISSION_VERIFY_CMD).toBe("bun test")
  })

  test("filters only server-provenanced Mission -> Squad tasks", () => {
    const board = {
      tasks: [
        {
          task: {
            id: "task_good",
            source: "mission",
            status: "completed",
            metadata: { actor: "mission", mission: { id: "m1", session_id: "ses_1" } },
          },
          evaluation: { verdict: "accepted" },
        },
        {
          task: {
            id: "task_forged",
            source: "panel",
            status: "completed",
            metadata: { actor: "mission", mission: { id: "m1", session_id: "ses_1" } },
          },
        },
        {
          task: {
            id: "task_other",
            source: "mission",
            status: "completed",
            metadata: { actor: "mission", mission: { id: "m2", session_id: "ses_2" } },
          },
        },
      ],
    }

    const rows = missionTaskRows(board, "m1")
    expect(rows.map((item) => item.task?.id)).toEqual(["task_good"])
    expect(terminalMissionTasks(rows).map((item) => item.task?.id)).toEqual(["task_good"])
  })

  test("report verdict rejects missing mission state or task provenance", () => {
    const rejected = evaluateMissionBenchmarkReport({
      missionID: "m1",
      sessionID: "ses_1",
      firstWakeCreated: true,
      secondWakeCreated: false,
      missionState: {
        "frontier.md": "",
        "tasks.md": "",
        "handoff.md": "",
        "notes.md": "",
      },
      missionTasks: [],
      localVerify: { status: "completed", exitCode: 0 },
    })
    expect(rejected.verdict).toBe("rejected")
    expect(rejected.failures.some((failure) => failure.includes("frontier.md"))).toBe(true)
    expect(rejected.failures.some((failure) => failure.includes("no mission-dispatched task"))).toBe(true)
  })

  test("report verdict accepts completed accepted mission task with populated state", () => {
    const accepted = evaluateMissionBenchmarkReport({
      missionID: "m1",
      sessionID: "ses_1",
      firstWakeCreated: true,
      secondWakeCreated: false,
      missionState: {
        "frontier.md": "done",
        "tasks.md": "task_good | completed | benchmark",
        "handoff.md": "task_good completed; mission complete",
        "notes.md": "investigation notes",
      },
      missionTasks: [
        {
          task: {
            id: "task_good",
            source: "mission",
            status: "completed",
            metadata: { actor: "mission", mission: { id: "m1", session_id: "ses_1" } },
          },
          evaluation: { verdict: "accepted" },
        },
      ],
      localVerify: { status: "completed", exitCode: 0 },
    })
    expect(accepted).toEqual({ verdict: "accepted", failures: [] })
  })

  test("report verdict rejects stale mission state that has not reconciled terminal tasks", () => {
    const tasks = [
      {
        task: {
          id: "task_good",
          source: "mission",
          status: "completed",
          metadata: { actor: "mission", mission: { id: "m1", session_id: "ses_1" } },
        },
      },
    ]
    expect(missionStateMentionsTerminalTasks({
      "frontier.md": "done",
      "tasks.md": "task_good | in_progress | benchmark",
      "handoff.md": "check again later",
      "notes.md": "notes",
    }, tasks)).toBe(false)

    const rejected = evaluateMissionBenchmarkReport({
      missionID: "m1",
      sessionID: "ses_1",
      firstWakeCreated: true,
      secondWakeCreated: false,
      missionState: {
        "frontier.md": "done",
        "tasks.md": "task_good | in_progress | benchmark",
        "handoff.md": "check again later",
        "notes.md": "notes",
      },
      missionTasks: tasks,
      localVerify: { status: "completed", exitCode: 0 },
    })
    expect(rejected.verdict).toBe("rejected")
    expect(rejected.failures).toContain("mission state does not reconcile the terminal mission task id and status")
  })
})

describe("mission benchmark executable wiring", () => {
  const src = readFileSync(scriptPath, "utf8")

  test("uses the mission wake route and never resurrects gateway master wake", () => {
    expect(src).toContain("/mission/wake")
    expect(src).not.toContain("/gateway/master/wake")
  })

  test("re-wakes the same mission for reconciliation", () => {
    expect(src).toContain("firstWake")
    expect(src).toContain("secondWake")
    expect(src).toContain("second wake created a new mission")
    expect(src).toContain("panel.query_task")
    expect(src).toContain("waitForMissionReconciliation")
  })

  test("threads the selected executor into the Mission dispatch prompt", () => {
    expect(src).toContain("Benchmark driver constraint")
    expect(src).toContain('set executor="${executor}"')
    expect(src).toContain("text: missionPrompt")
  })

  test("validates Mission-dispatched task provenance in the benchmark report", () => {
    expect(src).toContain("missionTaskRows")
    expect(src).toContain("source: item.task?.source")
    expect(src).toContain("metadata: item.task?.metadata")
  })

  test("disposes isolated instance state before stopping the benchmark server", () => {
    const disposeIndex = src.indexOf("await Instance.disposeAll().catch")
    const stopIndex = src.indexOf("await server.stop(true).catch")
    expect(disposeIndex).toBeGreaterThan(0)
    expect(stopIndex).toBeGreaterThan(disposeIndex)
  })
})
