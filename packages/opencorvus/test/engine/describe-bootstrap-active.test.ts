import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Database } from "../../src/storage/db"
import { ProjectTable } from "../../src/project/project.sql"
import { EngineGoalTable, EngineTaskTable, EngineArtifactTable } from "../../src/engine/engine.sql"
import { describeTask, renderTaskDescription } from "../../src/engine/describe"
import { Instance } from "../../src/project/instance"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

/**
 * Regression for scheduler fix regression contract P5 (commit
 * e87333dbb) + audit §11.4. Pre-fix, the bootstrap-first dispatch
 * constraint lived only inside the build tool's gate at
 * orchestrator/tools.ts:3826-3862 and only fired on dispatch (LATE
 * rejection). Bench evidence (lines 7456, 7860) showed the LLM
 * dispatching non-bootstrap goals in parallel — burning orchestrator
 * turns on rejected dispatches.
 *
 * P5 surfaces the constraint upstream:
 *   - describeTask annotates the task with `active_bootstrap_goal_id`
 *     when an unfinished bootstrap goal exists.
 *   - renderTaskDescription emits a physical-fact paragraph
 *     explaining the merge-conflict reality so the LLM can serialise
 *     dispatch on its own.
 *
 * The gate stays as defense-in-depth (codex 2nd-pass [P1]
 * "Keep an enforceable bootstrap safety guard"). Tests assert the
 * describe + render shape only; the gate's regression coverage is
 * a separate file.
 */

let projectID = ""
let taskID = ""
let runID = ""
let stamp = ""

function seedTaskWithGoals(
  goals: Array<{
    id: string
    kind: "feature" | "bootstrap" | "system" | "verification"
    status: "pending" | "running" | "passed" | "failed"
    depends_on?: string[]
    requirement_ids?: string[]
  }>,
) {
  const now = Date.now()
  Database.transaction((db) => {
    db.insert(ProjectTable)
      .values({
        id: projectID,
        worktree: process.cwd(),
        name: "P5 describe bootstrap test",
        sandboxes: [],
        time_created: now,
        time_updated: now,
      })
      .run()
    db.insert(EngineTaskTable)
      .values({
        id: taskID,
        project_id: projectID,
        source: "test",
        title: "P5 describe bootstrap",
        request: "test",
        kind: "workflow",
        priority: "normal",
        time_created: now,
        time_updated: now,
        time_started: now,
      })
      .run()
    db.insert(EngineArtifactTable)
      .values({
        id: runID,
        task_id: taskID,
        run_id: runID,
        kind: "run",
        label: "run-running",
        payload: {
          plan_version_id: null,
          session_id: null,
          executor: "opencorvus",
          status: "running",
          phase: "execute",
          blocking_reason: null,
          error: null,
          retry_count: 0,
          executor_ref: null,
          metadata: null,
          time_started: now,
          time_completed: null,
        },
        time_created: now,
        time_updated: now,
      })
      .run()
    let order = 0
    for (const g of goals) {
      db.insert(EngineGoalTable)
        .values({
          id: g.id,
          task_id: taskID,
          title: `Goal ${g.id}`,
          slug: g.id,
          objective: "obj",
          acceptance_specs: [],
          owned_paths: [],
          depends_on: g.depends_on ?? [],
          exports: [],
          imports: [],
          kind: g.kind,
          requirement_ids: g.requirement_ids ?? [],
          priority: "blocking",
          source: "test",
          status: g.status,
          order_index: order++,
          time_created: now,
          time_updated: now,
        })
        .run()
      // engine_goal.status is a cache (rule 8 — derived). goalStatusByID
      // reads from goal_run rows. To force a non-pending status in the
      // test, seed a goal_run_attempt artifact reflecting the desired
      // terminal state. "pending" / "running" are derived from absence
      // or live-tip presence; "passed" requires a completed run.
      if (g.status === "passed" || g.status === "failed" || g.status === "running") {
        const grunID = `${g.id}_run`
        const terminal = g.status === "passed" ? "completed" : g.status === "failed" ? "failed" : "running"
        const isTerminal = g.status === "passed" || g.status === "failed"
        db.insert(EngineArtifactTable)
          .values({
            id: grunID,
            task_id: taskID,
            run_id: runID,
            goal_run_id: grunID,
            kind: "goal_run_attempt",
            label: `attempt-${terminal}`,
            payload: {
              goal_id: g.id,
              plan_node_id: null,
              session_id: null,
              status: terminal,
              retry_count: 0,
              blocking_reason: null,
              error: null,
              workspace_dir: null,
              base_ref: null,
              merge_ref: null,
              supersede_of: null,
              superseded_reason: null,
              superseded_at: null,
              metadata:
                g.status === "passed"
                  ? {
                      manual_completion: {
                        source: "test.seedTaskWithGoals",
                        reason: "seeded evidence-satisfied completed goal",
                        time_completed: now,
                      },
                    }
                  : null,
              time_started: now,
              time_completed: isTerminal ? now : null,
            },
            time_created: now,
            time_updated: now,
          })
          .run()
      }
    }
  })
}

beforeEach(async () => {
  await resetDatabase()
  stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  projectID = `proj_p5_${stamp}`
  taskID = `task_p5_${stamp}`
  runID = `run_p5_${stamp}`
})

afterEach(async () => {
  await resetDatabase()
})

describe("P5 — describeTask.active_bootstrap_goal_id", () => {
  test("bootstrap goal not yet passed → field is the bootstrap goal id", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        seedTaskWithGoals([
          { id: `gol_boot_${stamp}`, kind: "bootstrap", status: "running" },
          { id: `gol_feat_1_${stamp}`, kind: "feature", status: "pending" },
          { id: `gol_feat_2_${stamp}`, kind: "feature", status: "pending" },
        ])
        const desc = await describeTask(taskID)
        expect(desc.active_bootstrap_goal_id).toBe(`gol_boot_${stamp}`)
      },
    })
  })

  test("bootstrap goal passed → field is undefined (constraint lifted)", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        seedTaskWithGoals([
          { id: `gol_boot_${stamp}`, kind: "bootstrap", status: "passed" },
          { id: `gol_feat_1_${stamp}`, kind: "feature", status: "pending" },
        ])
        const desc = await describeTask(taskID)
        expect(desc.active_bootstrap_goal_id).toBeUndefined()
      },
    })
  })

  test("no bootstrap goal in set → field is undefined", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        seedTaskWithGoals([
          { id: `gol_feat_1_${stamp}`, kind: "feature", status: "pending" },
          { id: `gol_feat_2_${stamp}`, kind: "feature", status: "pending" },
        ])
        const desc = await describeTask(taskID)
        expect(desc.active_bootstrap_goal_id).toBeUndefined()
      },
    })
  })

  test("multiple bootstrap goals → first non-passed wins (deterministic by order_index)", async () => {
    // Architectural invariant: in normal flow exactly one bootstrap goal
    // exists per task. This test pins the behaviour for the degenerate
    // multi-bootstrap case; it must not throw and must pick the first.
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        seedTaskWithGoals([
          { id: `gol_boot_1_${stamp}`, kind: "bootstrap", status: "passed" },
          { id: `gol_boot_2_${stamp}`, kind: "bootstrap", status: "running" },
          { id: `gol_feat_1_${stamp}`, kind: "feature", status: "pending" },
        ])
        const desc = await describeTask(taskID)
        expect(desc.active_bootstrap_goal_id).toBe(`gol_boot_2_${stamp}`)
      },
    })
  })
})

describe("P5 — renderTaskDescription emits the bootstrap-first paragraph", () => {
  test("paragraph appears when active_bootstrap_goal_id is set", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        seedTaskWithGoals([
          { id: `gol_boot_${stamp}`, kind: "bootstrap", status: "running" },
          { id: `gol_feat_1_${stamp}`, kind: "feature", status: "pending" },
        ])
        const desc = await describeTask(taskID)
        const md = renderTaskDescription(desc)
        expect(md).toContain("Bootstrap-first dispatch order")
        expect(md).toContain(`gol_boot_${stamp}`)
        expect(md).toContain("Plan deliberately")
        expect(md).toContain("files_changed[]")
        expect(md).not.toContain("dispatch tool will refuse non-bootstrap")
        expect(md).toContain("scaffold-level files")
        expect(md).toContain("coordination risk")
      },
    })
  })

  test("paragraph absent when no bootstrap is active (clean fan-out)", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        seedTaskWithGoals([
          { id: `gol_boot_${stamp}`, kind: "bootstrap", status: "passed" },
          { id: `gol_feat_1_${stamp}`, kind: "feature", status: "pending" },
          { id: `gol_feat_2_${stamp}`, kind: "feature", status: "pending" },
        ])
        const desc = await describeTask(taskID)
        const md = renderTaskDescription(desc)
        expect(md).not.toContain("Bootstrap-first dispatch order")
        expect(md).not.toContain("files_changed[] can explain")
      },
    })
  })

  test("paragraph absent when goal set has no bootstrap goal", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        seedTaskWithGoals([{ id: `gol_feat_1_${stamp}`, kind: "feature", status: "pending" }])
        const desc = await describeTask(taskID)
        const md = renderTaskDescription(desc)
        expect(md).not.toContain("Bootstrap-first dispatch order")
      },
    })
  })
})

describe("collaboration closure projection", () => {
  test("execution-started task renders dispatchable goals from dependency evidence", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const bootstrap = `gol_boot_${stamp}`
        const feature = `gol_feature_${stamp}`
        seedTaskWithGoals([
          { id: bootstrap, kind: "bootstrap", status: "passed" },
          { id: feature, kind: "feature", status: "pending", depends_on: [bootstrap] },
        ])

        const desc = await describeTask(taskID)
        expect(desc.collaboration_closure?.execution_started).toBe(true)
        expect(desc.collaboration_closure?.evidence_satisfied_goal_ids).toContain(bootstrap)
        expect(desc.collaboration_closure?.evidence_dispatchable_goal_ids).toContain(feature)

        const md = renderTaskDescription(desc)
        expect(md).toContain("## Collaboration Closure")
        expect(md).toContain("The active goal graph has entered execution")
        expect(md).toContain("Next evidence-dispatchable goals:")
        expect(md).toContain(feature)
        expect(md).toContain("Build `files_changed[]`")
        expect(md).toContain("`manage_task` action=modify_goal")
      },
    })
  })

  test("rendered goal description includes requirement ids for integrity traceability repairs", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const goal = `gol_trace_${stamp}`
        seedTaskWithGoals([{ id: goal, kind: "feature", status: "pending", requirement_ids: ["REQ-1", "REQ-3"] }])

        const desc = await describeTask(taskID)
        const md = renderTaskDescription(desc)

        expect(md).toContain("Requirement IDs: REQ-1, REQ-3")
      },
    })
  })

  test("dependency-blocked goals render their blockers instead of implying replanning", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const dependency = `gol_dep_${stamp}`
        const blocked = `gol_blocked_${stamp}`
        seedTaskWithGoals([
          { id: dependency, kind: "feature", status: "running" },
          { id: blocked, kind: "feature", status: "pending", depends_on: [dependency] },
        ])

        const desc = await describeTask(taskID)
        expect(desc.collaboration_closure?.blocked_goals).toEqual([
          {
            goal_id: blocked,
            blocked_by: [
              {
                goal_id: dependency,
                status: "running",
                evidence_status: "blocked",
                reason: `blocked(running(goal_run=${dependency}_run))`,
              },
            ],
          },
        ])

        const md = renderTaskDescription(desc)
        expect(md).toContain("Dependency-blocked goals:")
        expect(md).toContain(`${blocked}: blocked by ${dependency} [lifecycle=running; evidence=blocked; blocked(running(goal_run=${dependency}_run))]`)
        expect(md).not.toContain("re-run Architect to unblock")
      },
    })
  })

  test("failed goals stay inside same-graph diagnostic recovery", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const failed = `gol_failed_${stamp}`
        seedTaskWithGoals([{ id: failed, kind: "feature", status: "failed" }])

        const desc = await describeTask(taskID)
        expect(desc.collaboration_closure?.execution_started).toBe(true)
        expect(desc.collaboration_closure?.failed_goal_ids).toContain(failed)

        const md = renderTaskDescription(desc)
        expect(md).toContain("Failed goals requiring same-graph diagnosis:")
        expect(md).toContain("Failed goals stay inside the current collaboration closure")
        expect(md).toContain("route repair through `dispatch_agent` target=build")
        expect(md).toContain("`manage_task` action=modify_goal")
        expect(md).toContain("`dispatch_agent` target=architect mode=structural_reentry")
        expect(md).not.toContain("build({ goalID, request })")
        expect(md).not.toContain("`modify_goal`, or `architect`")
        expect(md).toContain("ask the operator only for external, destructive, or out-of-scope blockers")
        expect(md).toContain("Do not restart upstream merely because a Build attempt failed")
      },
    })
  })

  test("pre-execution goal graph is explicit planning window", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        seedTaskWithGoals([{ id: `gol_feature_${stamp}`, kind: "feature", status: "pending" }])

        const desc = await describeTask(taskID)
        expect(desc.collaboration_closure?.execution_started).toBe(false)
        const md = renderTaskDescription(desc)
        expect(md).toContain("Execution has not started yet; this is still the planning window.")
      },
    })
  })
})
