import { afterEach, expect, test } from "bun:test"
import { boardTag, currentGoalRunFromRows, compileBoard } from "../../src/workbench/board"
import { compileBrief } from "../../src/workbench/brief"
import { latestDeliveredGoalRunFromRows } from "../../src/engine/store"
import { Database } from "../../src/storage/db"
import { ProjectTable } from "../../src/project/project.sql"
import { EngineArtifactTable, EngineGoalTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { Event, TaskBoard } from "../../src/engine/model"
import { EngineProtocol } from "../../src/engine/protocol"
import { Instance } from "../../src/project/instance"
import { Memory } from "../../src/memory"
import { ProtocolEventTable } from "../../src/protocol/protocol.sql"
import { Identifier } from "../../src/id/id"
import { timelineOrderKey } from "../../src/timeline/order"
import { Session } from "../../src/session"
import { taskToolSessionMetadata } from "../../src/tool/task"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await resetDatabase()
})

test("currentGoalRunFromRows selects the supersede-chain tip", () => {
  const rows = [
    { id: "run_retry", supersede_of: "run_old" },
    { id: "run_old", supersede_of: null },
  ]

  expect(currentGoalRunFromRows(rows)?.id).toBe("run_retry")
})

test("currentGoalRunFromRows falls back to the first row when no supersede edge exists", () => {
  const rows = [
    { id: "run_latest", supersede_of: null },
    { id: "run_older", supersede_of: null },
  ]

  expect(currentGoalRunFromRows(rows)?.id).toBe("run_latest")
})

test("latestDeliveredGoalRunFromRows skips a fresh pending tip whose run has no acceptance, returning the prior delivered run", () => {
  // Regression for the post-rejection Files-panel hole: when a targeted
  // acceptance retry opens a fresh pending tip, that row has no acceptance yet, but the old
  // superseded row's merged files are still on master. Goal cards in the
  // overlay must anchor to the delivered run (not the tip) for the Files
  // panel + per-row diff fetch, otherwise G8/G9-style goals silently
  // disappear from the panel even though their commits exist.
  const rows = [
    { id: "run_post_reject_pending" }, // tip, newest, no acceptance
    { id: "run_passed_then_superseded" },
    { id: "run_old_failed" },
  ]
  const deliveries = new Set(["run_passed_then_superseded"])
  expect(latestDeliveredGoalRunFromRows(rows, (id) => deliveries.has(id))?.id).toBe("run_passed_then_superseded")
})

test("latestDeliveredGoalRunFromRows returns undefined when no run in the chain has shipped a acceptance", () => {
  const rows = [{ id: "run_pending_first_attempt" }]
  expect(latestDeliveredGoalRunFromRows(rows, () => false)).toBeUndefined()
})

test("latestDeliveredGoalRunFromRows prefers a newer delivered run over an older one", () => {
  const rows = [
    { id: "run_v3_passed" }, // newest, has acceptance
    { id: "run_v2_passed" }, // also has acceptance, older
    { id: "run_v1_failed" },
  ]
  const deliveries = new Set(["run_v3_passed", "run_v2_passed"])
  expect(latestDeliveredGoalRunFromRows(rows, (id) => deliveries.has(id))?.id).toBe("run_v3_passed")
})

test("compileBoard does not retain a mutable process board between hydrations", async () => {
  await resetDatabase()
  await using tmp = await tmpdir()
  const now = Date.now()
  const projectID = `project_board_no_cache_${now}`
  const taskID = `tsk_${now.toString(16)}BoardNoCache`

  Database.use((db) => {
    db.insert(ProjectTable)
      .values({
        id: projectID,
        worktree: tmp.path,
        name: "Board no process cache",
        sandboxes: "[]",
        time_created: now,
        time_updated: now,
      })
      .run()
    db.insert(EngineTaskTable)
      .values({
        id: taskID,
        project_id: projectID,
        source: "test",
        title: "Board no process cache",
        request: "initial request",
        priority: "normal",
        time_created: now,
        time_updated: now,
      })
      .run()
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = compileBoard({ taskID }) as any
      const tag = boardTag({ taskID })
      const expectedTaskOrderKey = timelineOrderKey({ domain: "task", time: now, id: taskID })
      expect(() => TaskBoard.parse(before)).not.toThrow()
      expect(before.task.orderKey).toBe(expectedTaskOrderKey)
      expect(before.task.kind).toBe("workflow")
      expect(before.task.queue).toEqual({ order: 0 })
      expect(before.task.request).toBe("initial request")
      expect(before.project).toEqual({
        id: projectID,
        name: "Board no process cache",
        worktree: tmp.path,
      })

      before.task.request = "mutated in memory"

      expect(boardTag({ taskID })).toBe(tag)
      const after = compileBoard({ taskID }) as any
      expect(after.snapshotVersion).toBe(tag)
      expect(after.task).not.toBe(before.task)
      expect(after.task.orderKey).toBe(expectedTaskOrderKey)
      expect(after.task.request).toBe("initial request")
    },
  })
})

test("compileBoard keeps build input evidence behind the contract artifact", async () => {
  await resetDatabase()
  await using tmp = await tmpdir()
  const now = Date.now()
  const stamp = now.toString(16)
  const projectID = `project_board_contract_${stamp}`
  const taskID = `tsk_board_contract_${stamp}`
  const runID = `run_board_contract_${stamp}`
  const goalID = `gol_board_contract_${stamp}`
  const goalRunID = `glr_board_contract_${stamp}`
  const contractID = `artifact_board_contract_${stamp}`

  Database.use((db) => {
    db.insert(ProjectTable)
      .values({
        id: projectID,
        worktree: tmp.path,
        name: "Board contract projection",
        sandboxes: "[]",
        time_created: now,
        time_updated: now,
      })
      .run()
    db.insert(EngineTaskTable)
      .values({
        id: taskID,
        project_id: projectID,
        source: "test",
        title: "Board contract projection",
        request: "project build contract facts",
        kind: "workflow",
        priority: "normal",
        attachments: [
          {
            sha: "current-task-sha",
            url: "/attachment/project_current/current-task-sha.png",
            mime: "image/png",
            size: 10,
            filename: "current.png",
          },
        ],
        time_created: now - 10_000,
        time_updated: now,
        time_started: now - 10_000,
      } as any)
      .run()
    db.insert(EngineArtifactTable)
      .values([
        {
          id: runID,
          task_id: taskID,
          run_id: runID,
          kind: "run",
          label: "run-running",
          payload: {
            status: "running",
            phase: "execute",
            executor: "opencorvus",
            retry_count: 0,
            metadata: {},
            time_started: now - 9_000,
            time_completed: null,
          },
          time_created: now - 9_000,
          time_updated: now - 9_000,
        },
        {
          id: contractID,
          task_id: taskID,
          run_id: runID,
          goal_run_id: goalRunID,
          kind: "build_session_contract",
          label: "build-session-contract",
          payload: {
            session_id: "ses_board_contract",
            task_id: taskID,
            goal_id: goalID,
            goal_run_id: goalRunID,
            spec_snapshot_id: "spec-board-contract",
            plan_version_id: "plan-board-contract",
            source_artifact_ids: ["artifact-source-contract"],
            digest: "digest-board-contract",
            input_evidence: {
              version: 1,
              project_id: projectID,
              task_id: taskID,
              goal_id: goalID,
              goal_run_id: goalRunID,
              session_id: "ses_board_contract",
              entries: [
                {
                  role: "source",
                  project_id: projectID,
                  sha: "contract-input-sha",
                  mime: "image/png",
                  size: 10,
                  filename: "contract.png",
                  legacy_attachment_url: `/attachment/${projectID}/contract-input-sha.png`,
                  staged_rel_path: ".opencorvus/input/contract.png",
                  sha_verified_at: now,
                },
              ],
            },
          },
          time_created: now,
          time_updated: now,
        },
      ] as any)
      .run()
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const board = compileBoard({ taskID }) as any
      const contract = board.artifacts.find((item: any) => item.kind === "build_session_contract")
      expect(contract?.payload).toEqual({
        session_id: "ses_board_contract",
        task_id: taskID,
        goal_id: goalID,
        goal_run_id: goalRunID,
        spec_snapshot_id: "spec-board-contract",
        plan_version_id: "plan-board-contract",
        digest: "digest-board-contract",
        goal_contract_snapshot: undefined,
        collaboration_goals_count: undefined,
        requirements_count: undefined,
        source_artifact_ids: ["artifact-source-contract"],
      })
      expect(JSON.stringify(contract.payload)).not.toContain("contract-input-sha")
      expect(JSON.stringify(contract.payload)).not.toContain("current-task-sha")
    },
  })
})

test("compileBoard projects actual agent invocation DAG from the task session tree", async () => {
  await resetDatabase()
  await using tmp = await tmpdir({ git: true })
  const now = Date.now()
  const taskID = Identifier.ascending("task")
  const goalID = Identifier.ascending("goal")

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const root = await Session.create({
        kind: "root",
        title: "Task root",
      })

      Database.use((db) =>
        db
          .insert(EngineTaskTable)
          .values({
            id: taskID,
            project_id: Instance.project.id,
            session_id: root.id,
            source: "test",
            title: "Agent DAG projection",
            request: "Project actual agent invocations as a DAG.",
            kind: "workflow",
            priority: "normal",
            time_created: now,
            time_updated: now,
            time_started: now,
          } as any)
          .run(),
      )

      const beforeTag = boardTag({ taskID })
      const before = compileBoard({ taskID }) as any
      expect(before.agentInvocationDAG).toMatchObject({
        taskID,
        rootSessionID: root.id,
        nodes: [],
        edges: [],
        topLevelSessionIDs: [],
      })

      const orchestrator = await Session.create({
        kind: "orchestrator",
        parentID: root.id,
        title: "Orchestrator",
      })
      const requirements = await Session.create({
        kind: "requirements",
        parentID: orchestrator.id,
        title: "Requirements",
      })
      const executor = await Session.create({
        kind: "executor",
        parentID: orchestrator.id,
        goalID,
        title: "Executor container",
      })
      const build = await Session.create({
        kind: "build",
        parentID: executor.id,
        goalID,
        title: "Build worker",
      })
      const assistant = await Session.create({
        kind: "assistant",
        parentID: build.id,
        title: "General subagent",
        metadata: taskToolSessionMetadata("general"),
      })

      const afterTag = boardTag({ taskID })
      expect(afterTag).not.toBe(beforeTag)

      const after = compileBoard({ taskID }) as any
      expect(() => TaskBoard.parse(after)).not.toThrow()
      const dag = after.agentInvocationDAG
      expect(dag.rootSessionID).toBe(root.id)
      expect([...dag.nodes.map((node: any) => node.sessionID)].sort()).toEqual(
        [orchestrator.id, requirements.id, build.id, assistant.id].sort(),
      )
      expect(dag.nodes.some((node: any) => node.sessionID === root.id || node.sessionID === executor.id)).toBe(false)

      const buildNode = dag.nodes.find((node: any) => node.sessionID === build.id)
      expect(buildNode).toMatchObject({
        agent: "build",
        kind: "build",
        parentSessionID: executor.id,
        parentAgentSessionID: orchestrator.id,
        goalID,
      })
      const assistantNode = dag.nodes.find((node: any) => node.sessionID === assistant.id)
      expect(assistantNode).toMatchObject({
        agent: "general",
        kind: "assistant",
        parentSessionID: build.id,
        parentAgentSessionID: build.id,
      })
      expect(dag.edges).toHaveLength(3)
      expect(dag.edges).toContainEqual({
        fromSessionID: orchestrator.id,
        toSessionID: requirements.id,
        relation: "agent_call",
      })
      expect(dag.edges).toContainEqual({
        fromSessionID: orchestrator.id,
        toSessionID: build.id,
        relation: "agent_call",
        viaSessionIDs: [executor.id],
      })
      expect(dag.edges).toContainEqual({ fromSessionID: build.id, toSessionID: assistant.id, relation: "agent_call" })
      expect(dag.topLevelSessionIDs).toEqual([orchestrator.id])
    },
  })
})

test("compileBoard does not materialize build phases for sessionless manual completions", async () => {
  await resetDatabase()
  await using tmp = await tmpdir()
  const now = Date.now()
  const stamp = now.toString(16)
  const projectID = `project_board_sessionless_complete_${stamp}`
  const taskID = `tsk_board_sessionless_complete_${stamp}`
  const goalID = `gol_board_sessionless_complete_${stamp}`
  const goalRunID = `glr_board_sessionless_complete_${stamp}`

  Database.use((db) => {
    db.insert(ProjectTable)
      .values({
        id: projectID,
        worktree: tmp.path,
        name: "Board sessionless completion",
        sandboxes: "[]",
        time_created: now,
        time_updated: now,
      })
      .run()
    db.insert(EngineTaskTable)
      .values({
        id: taskID,
        project_id: projectID,
        source: "test",
        title: "Board sessionless completion",
        request: "show manual completion without executor phase",
        kind: "workflow",
        priority: "normal",
        time_created: now,
        time_updated: now,
        time_started: now,
      } as any)
      .run()
    db.insert(EngineGoalTable)
      .values({
        id: goalID,
        task_id: taskID,
        title: "Already satisfied",
        slug: "already-satisfied",
        objective: "Represent work already proven satisfied without a build executor.",
        order_index: 0,
        time_created: now,
        time_updated: now,
      } as any)
      .run()
    db.insert(EngineArtifactTable)
      .values({
        id: goalRunID,
        task_id: taskID,
        run_id: null,
        goal_run_id: goalRunID,
        kind: "goal_run_attempt",
        label: "attempt-completed",
        payload: {
          goal_id: goalID,
          session_id: null,
          status: "completed",
          retry_count: 0,
          metadata: {
            manual_completion: {
              source: "orchestrator.complete_goal",
              reason: "Existing evidence proves this goal is already satisfied.",
              time_completed: now,
            },
          },
          time_started: now - 5_000,
          time_completed: now,
        },
        time_created: now,
        time_updated: now,
      })
      .run()
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const board = compileBoard({ taskID }) as any
      const goalWorkflow = board.goalWorkflows?.[0]
      const buildStep = goalWorkflow?.steps?.find((step: any) => step.stepID === "build")

      expect(goalWorkflow?.goalStatus).toBe("passed")
      expect(buildStep?.status).toBe("completed")
      expect(buildStep?.startedAt).toBeUndefined()
      expect(buildStep?.completedAt).toBeUndefined()
      expect(buildStep?.phases).toBeUndefined()
      expect(buildStep?.payload?.buildSessionID).toBeUndefined()
    },
  })
})

test("compileBrief surfaces memory recall backend errors", async () => {
  await resetDatabase()
  await using tmp = await tmpdir()
  const now = Date.now()
  const projectID = `project_brief_memory_error_${now}`
  const taskID = `tsk_${now.toString(16)}BriefMemoryError`

  Database.use((db) => {
    db.insert(ProjectTable)
      .values({
        id: projectID,
        worktree: tmp.path,
        name: "Brief memory error",
        sandboxes: "[]",
        time_created: now,
        time_updated: now,
      })
      .run()
    db.insert(EngineTaskTable)
      .values({
        id: taskID,
        project_id: projectID,
        source: "test",
        title: "Brief memory error",
        request: "Recall relevant memory while preparing the workbench brief",
        priority: "normal",
        time_created: now,
        time_updated: now,
      })
      .run()
  })

  const originalRecall = Memory.recall
  try {
    ;(Memory as typeof Memory & { recall: typeof Memory.recall }).recall = () => {
      throw new Error("memory index unavailable")
    }

    expect(() => compileBrief({ taskID })).toThrow("memory index unavailable")
  } finally {
    ;(Memory as typeof Memory & { recall: typeof Memory.recall }).recall = originalRecall
  }
})

test("board snapshot tag and task-scope status include workflow step protocol events", async () => {
  await resetDatabase()
  await using tmp = await tmpdir()
  const now = Date.now()
  const projectID = `project_board_${now}`
  const taskID = `tsk_${now.toString(16)}BoardProtocol`

  Database.use((db) =>
    db
      .insert(ProjectTable)
      .values({
        id: projectID,
        worktree: tmp.path,
        name: "Board protocol projection",
        sandboxes: "[]",
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
  Database.use((db) =>
    db
      .insert(EngineTaskTable)
      .values({
        id: taskID,
        project_id: projectID,
        source: "test",
        title: "Board protocol projection",
        request: "Show running task-scope steps from protocol events",
        priority: "normal",
        time_created: now,
        time_updated: now,
      })
      .run(),
  )

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = compileBoard({ taskID })
      const beforeTag = boardTag({ taskID })
      expect(before.lastSequence).toBe(0)
      expect(before.snapshotVersion).toBe(beforeTag)
      expect(before.workflow?.steps.find((step) => step.id === "architect")?.status).toBe("pending")

      await EngineProtocol.emit(
        Event.WorkflowStepUpdated,
        {
          taskID,
          stepID: "architect",
          status: "running",
          summary: 'Step "Architect" started',
        },
        { source: "test.board" },
      )

      const after = compileBoard({ taskID })
      const afterTag = boardTag({ taskID })
      expect(after.lastSequence).toBe(1)
      expect(after.snapshotVersion).toBe(afterTag)
      expect(after.snapshotVersion).not.toBe(before.snapshotVersion)
      expect(after.workflow?.steps.find((step) => step.id === "architect")?.status).toBe("running")
    },
  })
})

test("board snapshot tag ignores stream noise while lastSequence stays current", async () => {
  await resetDatabase()
  await using tmp = await tmpdir()
  const now = Date.now()
  const projectID = `project_board_noise_${now}`
  const taskID = `tsk_${now.toString(16)}BoardNoise`

  Database.use((db) => {
    db.insert(ProjectTable)
      .values({
        id: projectID,
        worktree: tmp.path,
        name: "Board protocol noise",
        sandboxes: "[]",
        time_created: now,
        time_updated: now,
      })
      .run()
    db.insert(EngineTaskTable)
      .values({
        id: taskID,
        project_id: projectID,
        source: "test",
        title: "Board protocol noise",
        request: "Ignore stream noise in board tag",
        priority: "normal",
        time_created: now,
        time_updated: now,
      })
      .run()
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = compileBoard({ taskID })
      const beforeTag = boardTag({ taskID })
      expect(before.lastSequence).toBe(0)

      Database.use((db) => {
        for (const [index, type] of ["test.session-status-noise", "review.stream.chunk"].entries()) {
          const seq = index + 1
          const eventID = Identifier.ascending("protocol_event")
          db.insert(ProtocolEventTable)
            .values({
              id: eventID,
              kind: "event",
              type,
              aggregate_type: "task",
              aggregate_id: taskID,
              task_id: taskID,
              source: "test.board-noise",
              seq,
              order_key: timelineOrderKey({ domain: "protocol", time: now + seq, sequence: seq, id: eventID }),
              emitted_at: now + seq,
              payload: { taskID, status: { type: "streaming" }, delta: "noise" },
              time_created: now + seq,
              time_updated: now + seq,
            })
            .run()
        }
      })

      const afterNoise = compileBoard({ taskID })
      expect(boardTag({ taskID })).toBe(beforeTag)
      expect(afterNoise.snapshotVersion).toBe(before.snapshotVersion)
      expect(afterNoise.lastSequence).toBe(2)

      await EngineProtocol.emit(
        Event.WorkflowStepUpdated,
        {
          taskID,
          stepID: "architect",
          status: "running",
          summary: 'Step "Architect" started',
        },
        { source: "test.board-visible" },
      )

      const afterVisible = compileBoard({ taskID })
      expect(afterVisible.lastSequence).toBe(3)
      expect(afterVisible.snapshotVersion).not.toBe(before.snapshotVersion)
      expect(afterVisible.workflow?.steps.find((step) => step.id === "architect")?.status).toBe("running")
    },
  })
})

test("cancelled terminal task without a run exposes task-level retry", async () => {
  await resetDatabase()
  await using tmp = await tmpdir()
  const now = Date.now()
  const projectID = `project_board_retry_${now}`
  const taskID = `tsk_board_retry_${now.toString(16)}`

  Database.use((db) => {
    db.insert(ProjectTable)
      .values({
        id: projectID,
        worktree: tmp.path,
        name: "Board runless retry projection",
        sandboxes: "[]",
        time_created: now,
        time_updated: now,
      })
      .run()
    db.insert(EngineTaskTable)
      .values({
        id: taskID,
        project_id: projectID,
        source: "test",
        title: "Runless cancelled task",
        request: "retry after provider failure",
        kind: "workflow",
        priority: "normal",
        time_created: now - 10_000,
        time_updated: now,
        time_started: now - 10_000,
        time_completed: now,
        error: "task cancelled",
        metadata: { cancelled: true },
      } as any)
      .run()
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const board = compileBoard({ taskID }) as any
      expect(board.task.status).toBe("cancelled")
      expect(board.overview.nextStep.kind).toBe("retry")
      expect(board.overview.controls.canRetry).toBe(true)
      expect(board.overview.controls.canCancel).toBe(false)
    },
  })
})

test("cancelled terminal task does not project partially completed goal workflow as running", async () => {
  await resetDatabase()
  await using tmp = await tmpdir()
  const now = Date.now()
  const stamp = now.toString(16)
  const projectID = `project_board_cancelled_workflow_${stamp}`
  const taskID = `tsk_board_cancelled_workflow_${stamp}`
  const runID = `run_board_cancelled_workflow_${stamp}`
  const completedGoalID = `gol_board_done_${stamp}`
  const pendingGoalID = `gol_board_pending_${stamp}`
  const completedGoalRunID = `glr_board_done_${stamp}`

  Database.use((db) => {
    db.insert(ProjectTable)
      .values({
        id: projectID,
        worktree: tmp.path,
        name: "Board cancelled workflow projection",
        sandboxes: "[]",
        time_created: now,
        time_updated: now,
      })
      .run()
    db.insert(EngineTaskTable)
      .values({
        id: taskID,
        project_id: projectID,
        source: "test",
        title: "Cancelled partial workflow",
        request: "cancel after some goals finish",
        kind: "workflow",
        priority: "normal",
        time_created: now - 10_000,
        time_updated: now,
        time_started: now - 10_000,
        time_completed: now,
        error: "operator cancelled",
        metadata: { cancelled: true },
      } as any)
      .run()
    db.insert(EngineGoalTable)
      .values([
        {
          id: completedGoalID,
          task_id: taskID,
          title: "Finished goal",
          slug: "finished-goal",
          objective: "Finish one goal before cancellation.",
          order_index: 0,
          time_created: now,
          time_updated: now,
        },
        {
          id: pendingGoalID,
          task_id: taskID,
          title: "Pending goal",
          slug: "pending-goal",
          objective: "Remain pending after cancellation.",
          order_index: 1,
          time_created: now,
          time_updated: now,
        },
      ] as any)
      .run()
    db.insert(EngineArtifactTable)
      .values({
        id: completedGoalRunID,
        task_id: taskID,
        run_id: runID,
        goal_run_id: completedGoalRunID,
        kind: "goal_run_attempt",
        label: "completed-before-cancel",
        payload: {
          goal_id: completedGoalID,
          status: "completed",
          retry_count: 0,
          time_started: now - 5_000,
          time_completed: now - 1_000,
        },
        time_created: now - 1_000,
        time_updated: now - 1_000,
      })
      .run()
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const board = compileBoard({ taskID }) as any
      const buildStep = board.workflow.steps.find((step: any) => step.id === "build")
      expect(board.task.status).toBe("cancelled")
      expect(board.overview.headline).toBe("Task was cancelled")
      expect(buildStep?.status).toBe("skipped")
      expect(buildStep?.status).not.toBe("running")
    },
  })
})

test("shutdown-interrupted task is not presented as acceptance failure", async () => {
  await resetDatabase()
  await using tmp = await tmpdir()
  const now = Date.now()
  const stamp = now.toString(16)
  const projectID = `project_board_interrupted_${stamp}`
  const taskID = `tsk_board_interrupted_${stamp}`
  const runID = `run_board_interrupted_${stamp}`
  const goalID = `gol_board_interrupted_${stamp}`
  const goalRunID = `glr_board_interrupted_${stamp}`
  const reason = "Server shutdown: SIGINT"

  Database.use((db) => {
    db.insert(ProjectTable)
      .values({
        id: projectID,
        worktree: tmp.path,
        name: "Board interrupted workflow projection",
        sandboxes: "[]",
        time_created: now,
        time_updated: now,
      })
      .run()
    db.insert(EngineTaskTable)
      .values({
        id: taskID,
        project_id: projectID,
        source: "test",
        title: "Interrupted task",
        request: "resume after server shutdown",
        kind: "workflow",
        priority: "normal",
        time_created: now - 10_000,
        time_updated: now,
        time_started: now - 10_000,
        time_completed: now,
        error: reason,
        metadata: { interrupted: true },
      } as any)
      .run()
    db.insert(EngineGoalTable)
      .values({
        id: goalID,
        task_id: taskID,
        title: "Interrupted goal",
        slug: "interrupted-goal",
        objective: "This goal was running when the server exited.",
        order_index: 0,
        time_created: now,
        time_updated: now,
      } as any)
      .run()
    db.insert(EngineArtifactTable)
      .values({
        id: goalRunID,
        task_id: taskID,
        run_id: runID,
        goal_run_id: goalRunID,
        kind: "goal_run_attempt",
        label: "running-before-shutdown",
        payload: {
          goal_id: goalID,
          status: "running",
          retry_count: 0,
          time_started: now - 5_000,
        },
        time_created: now - 5_000,
        time_updated: now - 5_000,
      })
      .run()
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const board = compileBoard({ taskID }) as any
      const buildStep = board.workflow.steps.find((step: any) => step.id === "build")
      expect(board.task.status).toBe("failed")
      expect(board.task.terminalReason).toBe("interrupted")
      expect(board.overview.currentFailure.title).toBe("Task interrupted")
      expect(board.overview.headline).toBe("Task was interrupted")
      expect(board.overview.nextStep.kind).toBe("retry")
      expect(buildStep?.status).toBe("pending")
      expect(buildStep?.status).not.toBe("failed")
    },
  })
})

test("queued task without a run exposes cancel but not retry", async () => {
  await resetDatabase()
  await using tmp = await tmpdir()
  const now = Date.now()
  const projectID = `project_board_cancel_${now}`
  const taskID = `tsk_board_cancel_${now.toString(16)}`

  Database.use((db) => {
    db.insert(ProjectTable)
      .values({
        id: projectID,
        worktree: tmp.path,
        name: "Board runless cancel projection",
        sandboxes: "[]",
        time_created: now,
        time_updated: now,
      })
      .run()
    db.insert(EngineTaskTable)
      .values({
        id: taskID,
        project_id: projectID,
        source: "test",
        title: "Runless queued task",
        request: "queued task",
        kind: "workflow",
        priority: "normal",
        time_created: now,
        time_updated: now,
      } as any)
      .run()
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const board = compileBoard({ taskID }) as any
      expect(board.task.status).toBe("queued")
      expect(board.overview.controls.canCancel).toBe(true)
      expect(board.overview.controls.canRetry).toBe(false)
    },
  })
})

test("compileBoard projects contribution and published commit refs separately", async () => {
  await resetDatabase()
  await using tmp = await tmpdir()
  const now = Date.now()
  const stamp = now.toString(16)
  const projectID = `project_board_commit_refs_${stamp}`
  const taskID = `tsk_board_commit_refs_${stamp}`
  const runID = `run_board_commit_refs_${stamp}`
  const goalID = `gol_board_commit_refs_${stamp}`
  const goalRunID = `glr_board_commit_refs_${stamp}`
  const acceptanceID = `acc_board_commit_refs_${stamp}`

  Database.use((db) => {
    db.insert(ProjectTable)
      .values({
        id: projectID,
        worktree: tmp.path,
        name: "Board commit ref projection",
        sandboxes: "[]",
        time_created: now,
        time_updated: now,
      })
      .run()
    db.insert(EngineTaskTable)
      .values({
        id: taskID,
        project_id: projectID,
        source: "test",
        title: "Commit ref projection",
        request: "project goal refs",
        kind: "workflow",
        priority: "normal",
        time_created: now - 10_000,
        time_updated: now,
        time_started: now - 10_000,
      } as any)
      .run()
    db.insert(EngineGoalTable)
      .values({
        id: goalID,
        task_id: taskID,
        title: "Evidence PRD",
        slug: "evidence-prd",
        objective: "Write one source-backed PRD.",
        order_index: 0,
        time_created: now,
        time_updated: now,
      } as any)
      .run()
    db.insert(EngineArtifactTable)
      .values([
        {
          id: goalRunID,
          task_id: taskID,
          run_id: runID,
          goal_run_id: goalRunID,
          kind: "goal_run_attempt",
          label: "attempt-completed",
          payload: {
            goal_id: goalID,
            status: "completed",
            retry_count: 0,
            time_started: now - 5_000,
            time_completed: now - 1_000,
          },
          time_created: now - 1_000,
          time_updated: now - 1_000,
        },
        {
          id: acceptanceID,
          task_id: taskID,
          run_id: runID,
          goal_run_id: goalRunID,
          acceptance_id: acceptanceID,
          kind: "acceptance",
          label: "acceptance-goal_run",
          payload: {
            status: "candidate",
            summary: "Goal delivered one PRD.",
            result: {
              summary: "Goal delivered one PRD.",
              commit_ref: "f6eef2c",
              published_commit_ref: "a393474",
              diff_base_ref: "a6bb0f9",
              diff_head_ref: "a393474",
              changed_files: ["docs/world-economy/evidence-prd.md"],
              diffs: [
                {
                  file: "docs/world-economy/evidence-prd.md",
                  status: "added",
                  additions: 565,
                  deletions: 0,
                },
              ],
              stats: { additions: 565, deletions: 0 },
            },
          },
          time_created: now,
          time_updated: now,
        },
      ] as any)
      .run()
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const board = compileBoard({ taskID }) as any
      const payloads = board.goalWorkflows?.[0]?.steps?.map((step: any) => step.payload).filter(Boolean) ?? []
      const payload = payloads.find((item: any) => item.changedFileDiffs?.length)
      expect(payload?.commitRef).toBe("f6eef2c")
      expect(payload?.publishedCommitRef).toBe("a393474")
      expect(payload?.diffBaseRef).toBe("a6bb0f9")
      expect(payload?.diffHeadRef).toBe("a393474")
      expect(payload?.changedFileDiffs).toEqual([
        {
          file: "docs/world-economy/evidence-prd.md",
          additions: 565,
          deletions: 0,
          status: "added",
        },
      ])
    },
  })
})

test("compileBoard projects terminal build outcome when goal has no acceptance", async () => {
  await resetDatabase()
  await using tmp = await tmpdir()
  const now = Date.now()
  const stamp = now.toString(16)
  const projectID = `project_board_build_outcome_${stamp}`
  const taskID = `tsk_board_build_outcome_${stamp}`
  const runID = `run_board_build_outcome_${stamp}`
  const goalID = `gol_board_build_outcome_${stamp}`
  const goalRunID = `glr_board_build_outcome_${stamp}`
  const outcomeID = `artifact_board_build_outcome_${stamp}`

  Database.use((db) => {
    db.insert(ProjectTable)
      .values({
        id: projectID,
        worktree: tmp.path,
        name: "Board build outcome projection",
        sandboxes: "[]",
        time_created: now,
        time_updated: now,
      })
      .run()
    db.insert(EngineTaskTable)
      .values({
        id: taskID,
        project_id: projectID,
        source: "test",
        title: "Build outcome projection",
        request: "show aborted build facts",
        kind: "workflow",
        priority: "normal",
        time_created: now - 10_000,
        time_updated: now,
        time_started: now - 10_000,
      } as any)
      .run()
    db.insert(EngineGoalTable)
      .values({
        id: goalID,
        task_id: taskID,
        title: "Visual parity",
        slug: "visual-parity",
        objective: "Verify visual parity.",
        order_index: 0,
        time_created: now,
        time_updated: now,
      } as any)
      .run()
    db.insert(EngineArtifactTable)
      .values([
        {
          id: goalRunID,
          task_id: taskID,
          run_id: runID,
          goal_run_id: goalRunID,
          kind: "goal_run_attempt",
          label: "attempt-aborted",
          payload: {
            goal_id: goalID,
            session_id: "ses_board_build_outcome",
            status: "aborted",
            retry_count: 1,
            error: "lost process ownership",
            time_started: now - 5_000,
            time_completed: now - 1_000,
          },
          time_created: now - 1_000,
          time_updated: now - 1_000,
        },
        {
          id: outcomeID,
          task_id: taskID,
          run_id: runID,
          goal_run_id: goalRunID,
          kind: "build_attempt_outcome",
          label: "aborted",
          payload: {
            task_id: taskID,
            goal_id: goalID,
            goal_run_id: goalRunID,
            run_id: runID,
            session_id: "ses_board_build_outcome",
            terminal_status: "aborted",
            outcome_kind: "aborted",
            summary: "Build attempt aborted: lost process ownership",
            error: "lost process ownership",
            no_diff_reason: null,
            host_facts: {
              contribution_commit_ref: null,
              published_commit_ref: null,
              diff_base_ref: null,
              diff_head_ref: null,
              actual_changed_files: [],
            },
            workspace: {
              dir: "C:/tmp/visual-parity",
              branch: "opencorvus/w/visual",
              base_ref: "base123",
            },
          },
          time_created: now,
          time_updated: now,
        },
      ] as any)
      .run()
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const board = compileBoard({ taskID }) as any
      const payloads = board.goalWorkflows?.[0]?.steps?.map((step: any) => step.payload).filter(Boolean) ?? []
      const payload = payloads.find((item: any) => item.buildOutcome)
      expect(board.goalWorkflows?.[0]?.goalStatus).toBe("failed")
      expect(board.goalWorkflows?.[0]?.steps?.some((step: any) => step.status === "aborted")).toBe(true)
      expect(payload?.buildOutcome).toEqual({
        id: outcomeID,
        goalRunID,
        terminalStatus: "aborted",
        outcomeKind: "aborted",
        acceptancePresent: false,
        summary: "Build attempt aborted: lost process ownership",
        error: "lost process ownership",
        noDiffReason: undefined,
        changedFiles: [],
        commitRef: undefined,
        publishedCommitRef: undefined,
        diffBaseRef: undefined,
        diffHeadRef: undefined,
      })
    },
  })
})
