import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import {
  DEFAULT_MISSION_BENCHMARK_REQUEST,
  DEFAULT_MISSION_VERIFY_CMD,
  MISSION_BENCHMARK_STAGES,
  evaluateMissionBenchmarkReport,
  missionTasksReadyForBenchmarkEvaluation,
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

  test("report verdict rejects completed mission tasks without evaluation verdicts", () => {
    const base = {
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
      localVerify: { status: "completed", exitCode: 0 },
    }

    for (const evaluation of [undefined, {}, { verdict: "" }]) {
      const rejected = evaluateMissionBenchmarkReport({
        ...base,
        missionTasks: [
          {
            task: {
              id: "task_good",
              source: "mission",
              status: "completed",
              metadata: { actor: "mission", mission: { id: "m1", session_id: "ses_1" } },
            },
            evaluation,
          },
        ],
      })
      expect(rejected.verdict).toBe("rejected")
      expect(rejected.failures).toContain("at least one completed mission task is missing an evaluation verdict")
    }

    const rejectedByVerdict = evaluateMissionBenchmarkReport({
      ...base,
      missionTasks: [
        {
          task: {
            id: "task_good",
            source: "mission",
            status: "completed",
            metadata: { actor: "mission", mission: { id: "m1", session_id: "ses_1" } },
          },
          evaluation: { verdict: "rejected" },
        },
      ],
    })
    expect(rejectedByVerdict.verdict).toBe("rejected")
    expect(rejectedByVerdict.failures).toContain("at least one completed mission task was not accepted by evaluation")
  })

  test("mission task readiness waits for completed task evaluation verdicts", () => {
    const completedWithoutEval = [
      {
        task: {
          id: "task_good",
          source: "mission",
          status: "completed",
          metadata: { actor: "mission", mission: { id: "m1", session_id: "ses_1" } },
        },
      },
    ]
    const completedAccepted = [
      {
        ...completedWithoutEval[0],
        evaluation: { verdict: "accepted" },
      },
    ]
    const completedRejected = [
      {
        ...completedWithoutEval[0],
        evaluation: { verdict: "rejected" },
      },
    ]

    expect(missionTasksReadyForBenchmarkEvaluation(completedWithoutEval)).toBe(false)
    expect(missionTasksReadyForBenchmarkEvaluation(completedAccepted)).toBe(true)
    expect(missionTasksReadyForBenchmarkEvaluation(completedRejected)).toBe(true)
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
    expect(
      missionStateMentionsTerminalTasks(
        {
          "frontier.md": "done",
          "tasks.md": "task_good | in_progress | benchmark",
          "handoff.md": "check again later",
          "notes.md": "notes",
        },
        tasks,
      ),
    ).toBe(false)

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

  test("report verdict rejects missing or skipped local verification", () => {
    const base = {
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
    }

    const missing = evaluateMissionBenchmarkReport(base)
    const skipped = evaluateMissionBenchmarkReport({
      ...base,
      localVerify: { status: "not_run", exitCode: null },
    })

    expect(missing.verdict).toBe("rejected")
    expect(missing.failures).toContain("local verification command did not run")
    expect(skipped.verdict).toBe("rejected")
    expect(skipped.failures).toContain("local verification command did not complete")
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
    expect(src).toContain("missionTasksReadyForBenchmarkEvaluation(rows)")
    expect(src).toContain("source: item.task?.source")
    expect(src).toContain("metadata: item.task?.metadata")
  })

  test("does not collapse unreadable mission state files into empty strings", () => {
    expect(src).toContain("mission state ${file} is unreadable")
    expect(src).not.toContain('.catch(() => "")')
  })

  test("disposes isolated instance state before stopping the benchmark server", () => {
    const disposeIndex = src.indexOf("await Instance.disposeAll().catch")
    const stopIndex = src.indexOf("await server.stop(true).catch")
    expect(disposeIndex).toBeGreaterThan(0)
    expect(stopIndex).toBeGreaterThan(disposeIndex)
  })

  test("exits explicitly only after cleanup has completed", () => {
    const disposeIndex = src.indexOf("await Instance.disposeAll().catch")
    const stopIndex = src.indexOf("await server.stop(true).catch")
    const exitIndex = src.indexOf("process.exit(finalExitCode)")
    expect(src).toContain("let finalExitCode = 1")
    expect(exitIndex).toBeGreaterThan(stopIndex)
    expect(exitIndex).toBeGreaterThan(disposeIndex)
  })

  test("uses observable inactivity timeout instead of a mechanical total wait deadline", () => {
    expect(src).toContain("--idle-timeout-ms")
    expect(src).toContain("const idleTimeoutMs = parsePositiveInt")
    expect(src).toContain("let idleDeadline = Date.now() + idleTimeoutMs")
    expect(src).toContain("idleDeadline = Date.now() + idleTimeoutMs")
    expect(src).toContain("idle timed out waiting for")
    expect(src).toContain("missionRowsActivityKey(rows)")
    expect(src).toContain("missionStateActivityKey(state)")
    expect(src).toContain("SessionStatus.getActivity(sessionID)")
    expect(src).toContain('`${status.type}:${activity?.last_activity_at ?? "no-stream-activity"}`')
    expect(src).not.toContain("activityKey: status.type")
    expect(src).not.toContain("--max-wait-ms")
    expect(src).not.toContain("maxWaitMs")
    expect(src).not.toContain("const deadline = Date.now()")
    expect(src).not.toContain("Date.now() < deadline")
    expect(src).not.toContain("`timed out waiting for ${label}")
  })

  test("does not allow bypassing local verification", () => {
    expect(src).not.toContain("--skip-local-verify")
    expect(src).not.toContain("skipLocalVerify")
    expect(src).not.toContain("skippedVerify")
    expect(src).not.toContain('status: "not_run"')
    expect(src).toContain("const localVerify = await runLocalVerify")
    expect(src).toContain("Shell.run(cmd, { cwd, idleTimeoutMs })")
    expect(src).toContain('status: result.idleTimedOut ? "idle_timeout" : "completed"')
    expect(src).not.toContain("Bun.spawn")
    expect(src).not.toContain("proc.exited")
    expect(src).toContain('throw new Error("acceptance verification command is required")')
  })
})
