import { describe, expect, test } from "bun:test"
import { taskStatusDetailFromBoard } from "../../src/status/task-status-snapshot"

describe("taskStatusDetailFromBoard", () => {
  function emptyAgentInvocationDAG(taskID: string) {
    return {
      taskID,
      nodes: [],
      edges: [],
      topLevelSessionIDs: [],
    }
  }

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
      agentInvocationDAG: emptyAgentInvocationDAG("tsk_status_snapshot_aborted"),
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
    expect(detail.agentInvocationDAG.nodes).toEqual([])
    expect(detail.workflow?.steps[0]).toMatchObject({ rawStatus: "aborted", status: "failed" })
    expect(detail.goals[0]?.status).toBe("failed")
    expect(detail.goals[0]?.progress).toMatchObject({ total: 1, failed: 1 })
    expect(detail.goals[0]?.steps[0]).toMatchObject({ rawStatus: "aborted", status: "failed" })
    expect(detail.goals[0]?.steps[0]?.phases?.[0]).toMatchObject({ rawStatus: "aborted", status: "failed" })
  })

  test("does not synthesize agent DAG nodes from pending workflow steps", () => {
    const detail = taskStatusDetailFromBoard({
      task: {
        id: "tsk_status_snapshot_pending_dag",
        orderKey: "v1:task:002",
        projectID: "project-status-snapshot",
        source: "test",
        title: "Pending workflow without agents",
        request: "Keep pending workflow separate from executed agent DAG.",
        status: "queued",
        priority: "normal",
        time: {
          created: 1,
          updated: 2,
        },
      },
      agentInvocationDAG: emptyAgentInvocationDAG("tsk_status_snapshot_pending_dag"),
      workflow: {
        id: "pipeline",
        name: "Pipeline",
        goalLoopStepIDs: ["build"],
        steps: [
          {
            id: "requirements",
            orderKey: "v1:step:001",
            label: "Requirements",
            tool: "requirements",
            scope: "task",
            skippable: false,
            status: "pending",
          },
          {
            id: "build",
            orderKey: "v1:step:002",
            label: "Build",
            tool: "build",
            scope: "goal",
            skippable: false,
            status: "pending",
          },
        ],
      },
    })

    expect(detail.agentInvocationDAG.nodes).toEqual([])
    expect(detail.workflow?.steps.map((step) => step.rawStatus)).toEqual(["pending", "pending"])
    expect(detail.progress).toMatchObject({ total: 2, completed: 0, failed: 0, running: 0, pending: 2 })
  })

  test("projects task-level direct build outcomes into status detail", () => {
    const detail = taskStatusDetailFromBoard({
      task: {
        id: "tsk_status_snapshot_direct_build",
        orderKey: "v1:task:003",
        projectID: "project-status-snapshot",
        source: "test",
        title: "Direct build outcome status projection",
        request: "Expose direct build outcome evidence in status snapshots.",
        status: "active",
        priority: "normal",
        time: {
          created: 1,
          updated: 2,
        },
      },
      agentInvocationDAG: emptyAgentInvocationDAG("tsk_status_snapshot_direct_build"),
      workflow: {
        id: "direct",
        name: "Direct",
        goalLoopStepIDs: [],
        steps: [
          {
            id: "build",
            orderKey: "v1:step:001",
            label: "Build",
            tool: "build",
            scope: "task",
            skippable: false,
            status: "failed",
          },
        ],
      },
      taskAgentOutcomes: [
        {
          id: "artifact_direct_build_failed",
          provider: "build",
          artifactKind: "build_attempt_outcome",
          scope: "task",
          runID: "run_direct_build_failed",
          sessionID: "ses_direct_build_failed",
          status: "failed",
          result: "failed",
          summary: "Direct build failed before producing a verdict.",
          error: "synthetic direct build infrastructure failure",
          time: {
            created: 3,
            updated: 3,
          },
        },
      ],
    })

    expect(detail.status).toBe("failed")
    expect(detail.progress).toMatchObject({ total: 1, completed: 0, failed: 1, running: 0, pending: 0 })
    expect(detail.workflow?.steps[0]).toMatchObject({ rawStatus: "failed", status: "failed" })
    expect(detail.taskAgentOutcomes).toEqual([
      expect.objectContaining({
        id: "artifact_direct_build_failed",
        provider: "build",
        artifactKind: "build_attempt_outcome",
        sessionID: "ses_direct_build_failed",
        status: "failed",
        result: "failed",
        error: "synthetic direct build infrastructure failure",
      }),
    ])
  })
})
