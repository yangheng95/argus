import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { renderSpecsAsText } from "../../src/acceptance/types"
import {
  EngineGoalTable,
  EnginePlanNodeTable,
  EnginePlanVersionTable,
  EngineTaskTable,
} from "../../src/engine/engine.sql"
import { createActivePlanGraph, insertGoalRows } from "../../src/engine/persist"
import { insertEngineSpecSnapshot } from "../../src/engine/spec-snapshot"
import { findActivePlanForTask } from "../../src/engine/store"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Database, eq } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

let tmp: Awaited<ReturnType<typeof tmpdir>>
let taskID = ""
let specSnapshotID = ""
let rootSessionID = ""

beforeEach(async () => {
  await resetDatabase()
  tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const root = await Session.create({ kind: "root", title: "active plan graph writer" })
      rootSessionID = root.id
      taskID = Identifier.ascending("task")
      const now = Date.now()
      Database.use((db) =>
        db
          .insert(EngineTaskTable)
          .values({
            id: taskID,
            project_id: Instance.project.id,
            session_id: root.id,
            source: "test",
            title: "active plan graph writer",
            request: "Verify active plan graph write boundary.",
            priority: "normal",
            time_created: now,
            time_updated: now,
          })
          .run(),
      )
      specSnapshotID = Database.transaction((db) =>
        insertEngineSpecSnapshot(db, {
          taskID,
          version: 1,
          status: "ready",
          summary: "Spec summary",
          content: "Spec content",
          scope: "Spec scope",
          timeCreated: now,
        }),
      )
    },
  })
})

afterEach(async () => {
  await Instance.disposeAll()
  await resetDatabase()
  await tmp?.[Symbol.asyncDispose]?.()
})

describe("active plan graph writer", () => {
  test("creates one active plan graph and repoints goals through the writer", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const acceptance = [
          {
            id: "acc-alpha",
            source_requirement_id: "REQ-1",
            goal_id: "goal_alpha",
            title: "Alpha acceptance",
            severity: "essential" as const,
            scorers: [
              {
                type: "llm_judge" as const,
                name: "alpha judge",
                criteria: "Alpha implementation satisfies the requested behavior.",
              },
            ],
          },
        ]
        const goals = Database.transaction((db) =>
          insertGoalRows(db, {
            taskID,
            specSnapshotID,
            now,
            goals: [
              {
                title: "Alpha",
                objective: "Build alpha.",
                acceptance_specs: acceptance,
                owned_paths: ["src/alpha.ts"],
              },
              {
                title: "Beta",
                objective: "Build beta.",
                acceptance_specs: [],
                owned_paths: ["src/beta.ts"],
                depends_on: ["goal_alpha"],
              },
              {
                title: "Gamma",
                objective: "Build gamma.",
                acceptance_specs: [],
                owned_paths: ["src/gamma.ts"],
                depends_on: ["missing_goal"],
              },
            ].map((goal, index) => ({
              goalID: index === 0 ? "goal_alpha" : index === 1 ? "goal_beta" : "goal_gamma",
              ...goal,
            })),
          }),
        )

        const priorPlanID = "plan_prior_active"
        Database.use((db) =>
          db
            .insert(EnginePlanVersionTable)
            .values({
              id: priorPlanID,
              task_id: taskID,
              spec_snapshot_id: specSnapshotID,
              version: 42,
              status: "active",
              summary: "Prior plan",
              prompt: "Prior prompt",
              metadata: {},
              time_created: now - 10,
              time_updated: now - 10,
            })
            .run(),
        )

        const created = Database.transaction((db) =>
          createActivePlanGraph(db, {
            taskID,
            specSnapshotID,
            prompt: "Create execution plan.",
            goals: goals.map((goal) => ({
              id: goal.id,
              title: goal.title,
              acceptance_specs: goal.acceptance_specs,
              depends_on: goal.id === "goal_beta" ? ["goal_alpha"] : goal.id === "goal_gamma" ? ["missing_goal"] : [],
            })),
            now: now + 1,
          }),
        )

        expect(created.planID).toMatch(/^pln_/)
        expect(created.planNodeIDs).toHaveLength(3)
        const activePlan = findActivePlanForTask(taskID)
        expect(activePlan).toMatchObject({
          id: created.planID,
          task_id: taskID,
          spec_snapshot_id: specSnapshotID,
          version: 1,
          status: "active",
          summary: "3 goals",
          prompt: "Create execution plan.",
          time_created: now + 1,
          time_updated: now + 1,
        })

        const priorPlan = Database.use((db) =>
          db.select().from(EnginePlanVersionTable).where(eq(EnginePlanVersionTable.id, priorPlanID)).get(),
        )
        expect(priorPlan).toMatchObject({ status: "superseded", time_updated: now + 1 })

        const nodes = Database.use((db) =>
          db
            .select()
            .from(EnginePlanNodeTable)
            .where(eq(EnginePlanNodeTable.plan_version_id, created.planID))
            .orderBy(EnginePlanNodeTable.order_index)
            .all(),
        )
        expect(nodes.map((node) => node.goal_id)).toEqual(["goal_alpha", "goal_beta", "goal_gamma"])
        expect(nodes[0]).toMatchObject({
          id: created.planNodeIDs[0],
          brief: renderSpecsAsText(acceptance),
          depends_on_ids: null,
          order_index: 0,
        })
        expect(nodes[1]).toMatchObject({
          id: created.planNodeIDs[1],
          depends_on_ids: [created.planNodeIDs[0]],
          order_index: 1,
        })
        expect(nodes[2]).toMatchObject({
          id: created.planNodeIDs[2],
          depends_on_ids: null,
          order_index: 2,
        })

        const persistedGoals = Database.use((db) =>
          db
            .select({
              id: EngineGoalTable.id,
              planVersionID: EngineGoalTable.plan_version_id,
              timeUpdated: EngineGoalTable.time_updated,
            })
            .from(EngineGoalTable)
            .where(eq(EngineGoalTable.task_id, taskID))
            .all(),
        )
        expect(persistedGoals).toHaveLength(3)
        for (const goal of persistedGoals) {
          expect(goal).toMatchObject({ planVersionID: created.planID, timeUpdated: now + 1 })
        }
      },
    })
  })
})
