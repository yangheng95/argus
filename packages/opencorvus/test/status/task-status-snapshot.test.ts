import { describe, expect, test } from "bun:test"
import { taskStatusDetailFromBoard } from "../../src/status/task-status-snapshot"

describe("taskStatusDetailFromBoard", () => {
  test("preserves aborted workflow raw status and counts it as failed", () => {
    const detail = taskStatusDetailFromBoard({
      task: {
        id: "tsk_status_snapshot_aborted",
        orderKey: "v1:task:001",
        projectID: "project-status-snapshot",
        source: "test",
        title: "Aborted status projection",
        request: "Project aborted workflow states into mission status.",
        status: "active",
        priority: "normal",
        time: {
          created: 1,
          updated: 2,
        },
      },
      workflow: {
        id: "pipeline",
        name: "Pipeline",
        goalLoopStepIDs: ["build"],
        steps: [
          {
            id: "build",
            orderKey: "v1:step:001",
            label: "Build",
            tool: "build",
            scope: "goal",
            skippable: false,
            status: "aborted",
          },
        ],
      },
      goalWorkflows: [
        {
          goalID: "gol_status_snapshot_aborted",
          orderKey: "v1:goal:001",
          goalTitle: "Render aborted goal",
          goalStatus: "running",
          orderIndex: 0,
          retryCount: 0,
          priority: "blocking",
          steps: [
            {
              stepID: "build",
              orderKey: "v1:goal-step:001",
              label: "Build",
              status: "aborted",
              phases: {
                evaluate: {
                  orderKey: "v1:phase:001",
                  status: "aborted",
                },
              },
            },
          ],
        },
      ],
    })

    expect(detail.status).toBe("failed")
    expect(detail.progress).toMatchObject({ total: 2, completed: 0, failed: 2, running: 0, pending: 0 })
    expect(detail.workflow?.steps[0]).toMatchObject({ rawStatus: "aborted", status: "failed" })
    expect(detail.goals[0]?.status).toBe("failed")
    expect(detail.goals[0]?.progress).toMatchObject({ total: 1, failed: 1 })
    expect(detail.goals[0]?.steps[0]).toMatchObject({ rawStatus: "aborted", status: "failed" })
    expect(detail.goals[0]?.steps[0]?.phases?.[0]).toMatchObject({ rawStatus: "aborted", status: "failed" })
  })
})
