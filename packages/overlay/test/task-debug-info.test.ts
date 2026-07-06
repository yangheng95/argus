import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { buildTaskDebugBlob } from "../src/utils/debug-info"

const OVERLAY_ROOT = join(import.meta.dir, "..")

function source(path: string): string {
  return readFileSync(join(OVERLAY_ROOT, path), "utf8")
}

test("task debug info keeps the concise workflow identity header", () => {
  const debugInfo = source("src/utils/debug-info.ts")
  const main = source("src/main.tsx")

  expect(debugInfo).toContain("# Task Debug Info (double-click 任务 → clipboard)")
  expect(debugInfo).toContain("task.id:")
  expect(debugInfo).toContain("task.terminal:")
  expect(debugInfo).toContain("task.directory:")
  expect(debugInfo).toContain("project.worktree:")
  expect(debugInfo).toContain("server.url:")
  expect(debugInfo).toContain("runtime.db:")
  expect(debugInfo).toContain("task.session:")
  expect(debugInfo).toContain("task.run.id:")
  expect(debugInfo).toContain("Task Agent Outcomes (${taskAgentOutcomes.length}):")
  expect(debugInfo).toContain("Goals (${goalWorkflows.length}):")
  expect(main).toContain("buildTaskDebugBlob(boardStore.board, appStore.enginePaths)")
})

test("task debug info includes only the compact Files panel board projection summary", () => {
  const debugInfo = source("src/utils/debug-info.ts")

  expect(debugInfo).toContain("files:     ${debugGoalBoardFiles(gw)}")
  expect(debugInfo).toContain(
    "acceptedChangedFiles=${acceptedChangedFiles}; attemptChangedFiles=${attemptChangedFiles}; changedFileDiffs=${changedFileDiffs}; ",
  )
  expect(debugInfo).toContain("contributionCommits=${commitRefs.size")
  expect(debugInfo).toContain("publishedCommits=${publishedCommitRefs.size")
  expect(debugInfo).toContain("diffRefs=${diffRefs.size")
  expect(debugInfo).toContain("outcomes=${outcomes.size")
  expect(debugInfo).toContain("noAcceptance=${noAcceptanceReasons.size")
  expect(debugInfo).not.toContain("commits=${commitRefs.size")
})

test("task debug info includes task-level direct build attempts outside goals", () => {
  const blob = buildTaskDebugBlob(
    {
      task: {
        id: "tsk_debug_direct_build",
        title: "Debug direct build outcome",
        status: "failed",
        terminalReason: "failed",
        directory: "C:/repo",
        sessionID: "ses_debug_direct_build",
        activeRunID: "run_debug_direct_build",
        time: { created: Date.now(), updated: Date.now() },
      },
      project: {
        id: "proj_debug_direct_build",
        name: "Debug project",
        worktree: "C:/canonical/project",
      },
      taskAgentOutcomes: [
        {
          id: "artifact_debug_direct_build",
          provider: "build",
          artifactKind: "build_attempt_outcome",
          scope: "task",
          runID: "run_debug_direct_build",
          sessionID: "ses_debug_direct_build_child",
          status: "completed",
          result: "delivered",
        },
      ],
      goalWorkflows: [],
    },
    { database: "C:/runtime/opencorvus.db" },
  )

  expect(blob).toContain("Task Agent Outcomes (1):")
  expect(blob).toContain("artifact_debug_direct_build")
  expect(blob).toContain("provider=build; kind=build_attempt_outcome")
  expect(blob).toContain("status=completed; result=delivered")
  expect(blob).toContain("run=run_debug_direct_build; session=ses_debug_direct_build_child")
  expect(blob).not.toContain("actualChangedFiles")
  expect(blob).not.toContain("publishedCommit")
  expect(blob).toContain("Goals (0):")
})

test("mission status client type mirrors task-level build outcomes and aborted raw statuses", () => {
  const mission = source("src/services/mission.ts")

  expect(mission).toContain('"pending" | "running" | "completed" | "skipped" | "failed" | "aborted"')
  expect(mission).toContain("export interface TaskStatusAgentOutcome")
  expect(mission).toContain('scope: "task" | "goal"')
  expect(mission).toContain("taskAgentOutcomes: TaskStatusAgentOutcome[]")
})

test("task debug info explains zero changed files with terminal build outcome", () => {
  const blob = buildTaskDebugBlob(
    {
      task: {
        id: "tsk_debug_outcome",
        title: "Debug build outcome",
        status: "failed",
        terminalReason: "failed",
        directory: "C:/repo",
        sessionID: "ses_debug_outcome",
        time: { created: Date.now(), updated: Date.now() },
      },
      project: {
        id: "proj_debug_outcome",
        name: "Debug project",
        worktree: "C:/canonical/project",
      },
      goalWorkflows: [
        {
          goalID: "gol_debug_outcome",
          orderIndex: 0,
          goalStatus: "failed",
          goalTitle: "Visual parity",
          retryCount: 1,
          steps: [
            {
              payload: {
                buildOutcome: {
                  id: "artifact_debug_outcome",
                  goalRunID: "grun_debug_outcome",
                  terminalStatus: "aborted",
                  outcomeKind: "aborted",
                  acceptancePresent: false,
                  changedFiles: [],
                },
              },
            },
          ],
        },
      ],
    },
    { database: "C:/runtime/opencorvus.db" },
  )

  expect(blob).toContain("acceptedChangedFiles=0; attemptChangedFiles=0; changedFileDiffs=0")
  expect(blob).not.toContain("changedFiles=0")
  expect(blob).toContain("task.directory: C:/repo")
  expect(blob).toContain("project.worktree: C:/canonical/project")
  expect(blob).toContain("outcomes=grun_debug_outcome:aborted/aborted")
  expect(blob).toContain("noAcceptance=grun_debug_outcome:aborted")
})

test("task debug info omits the old redundant notes, HTTP probes, and SQL templates", () => {
  const debugInfo = source("src/utils/debug-info.ts")

  expect(debugInfo).not.toContain("Notes:")
  expect(debugInfo).not.toContain("Project-scoped HTTP probes")
  expect(debugInfo).not.toContain("Invoke-RestMethod")
  expect(debugInfo).not.toContain("SQL templates")
  expect(debugInfo).not.toContain("Runtime DB path (single source)")
  expect(debugInfo).not.toContain("SELECT * FROM engine_task")
  expect(debugInfo).not.toContain("protocol_event WHERE task_id")
})

test("mission debug info is copyable from mission rows without using rename double click", () => {
  const debugInfo = source("src/utils/debug-info.ts")
  const missionList = source("src/components/MissionList.tsx")

  expect(debugInfo).toContain("# Mission Debug Info (double-click mission → clipboard)")
  expect(debugInfo).toContain("mission.id:")
  expect(debugInfo).toContain("mission.session:")
  expect(debugInfo).toContain("Task counts:")
  expect(debugInfo).toContain("Tasks (${tasks.length}):")
  expect(missionList).toContain("buildMissionDebugBlob(props.mission)")
  expect(missionList).toContain("[mission-row dblclick] clipboard write failed")
  expect(missionList).toContain("<MissionRenameButton")
  expect(missionList).toContain("onClick={beginRename}")
})

test("chat debug info is copyable from the conversation title for standalone sessions", () => {
  const debugInfo = source("src/utils/debug-info.ts")
  const main = source("src/main.tsx")

  expect(debugInfo).toContain("# Chat Debug Info (double-click chat → clipboard)")
  expect(debugInfo).toContain("chat.session:")
  expect(debugInfo).toContain("selected.source: ${source.kind}:${source.id}")
  expect(debugInfo).toContain("top.level: ${cardTree.order.length}")
  expect(main).toContain("buildChatDebugBlob(boardStore.board, selectedSource, cardTreeStore)")
  expect(main).toContain('selectedSource?.kind === "session"')
})
