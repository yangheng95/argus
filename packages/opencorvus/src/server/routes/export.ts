import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Session } from "@/session"
import { errors } from "../error"
import { lazy } from "../../util/lazy"
import {
  findActivePlanForTask,
  findDeliveryByRun,
  findEvaluationByRun,
  findRuns,
  listGoalsByPlan,
  listInteractions,
  listMilestones,
  listSnapshots,
  requireTask,
  viewDelivery,
  viewEvaluation,
  viewGoal,
  viewInteraction,
  viewMilestone,
  viewPlan,
  viewRun,
  viewSnapshot,
  viewTask,
  findArtifacts,
  viewArtifact,
  Task,
} from "@/engine"
import { goalStatusByID } from "@/engine/describe"

/**
 * Export routes — 提供任务和会话的完整导出接口，供外部工具消费。
 */
export const ExportRoutes = lazy(() =>
  new Hono()
    .get(
      "/task/:taskID",
      describeRoute({
        summary: "Export full task data",
        operationId: "export.task",
        responses: {
          200: {
            description: "Complete task export including plan, runs, evaluations, goals, milestones, interactions, snapshots, and artifacts",
            content: {
              "application/json": {
                schema: resolver(z.object({
                  task: z.unknown(),
                  plan: z.unknown().optional(),
                  goals: z.unknown().array(),
                  milestones: z.unknown().array(),
                  runs: z.unknown().array(),
                  interactions: z.unknown().array(),
                  snapshots: z.unknown().array(),
                  deliveries: z.unknown().array(),
                  evaluations: z.unknown().array(),
                  artifacts: z.unknown().array(),
                })),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ taskID: Task.shape.id })),
      async (c) => {
        const taskID = c.req.valid("param").taskID
        const task = requireTask(taskID)
        const plan = findActivePlanForTask(task.id)
        const goals = plan ? listGoalsByPlan(plan.id) : []
        const milestones = listMilestones(taskID)
        const runs = findRuns(taskID)
        const interactions = listInteractions(taskID)
        const snapshots = listSnapshots(taskID)

        // 收集所有 run 的 delivery、evaluation、artifact
        const deliveries: ReturnType<typeof viewDelivery>[] = []
        const evaluations: ReturnType<typeof viewEvaluation>[] = []
        const artifacts: ReturnType<typeof viewArtifact>[] = []
        for (const run of runs) {
          const delivery = findDeliveryByRun(run.id)
          if (delivery) deliveries.push(viewDelivery(delivery))
          const evaluation = findEvaluationByRun(run.id)
          if (evaluation) evaluations.push(viewEvaluation(evaluation))
          artifacts.push(...findArtifacts(run.id).map(viewArtifact))
        }

        return c.json({
          task: viewTask(task),
          plan: plan ? viewPlan(plan) : undefined,
          goals: goals.map((g) => ({ ...viewGoal(g), status: goalStatusByID(g.id) })),
          milestones: milestones.map(viewMilestone),
          runs: runs.map(viewRun),
          interactions: interactions.map(viewInteraction),
          snapshots: snapshots.map(viewSnapshot),
          deliveries,
          evaluations,
          artifacts,
        })
      },
    )
    .get(
      "/session/:sessionID",
      describeRoute({
        summary: "Export session messages",
        operationId: "export.session",
        responses: {
          200: {
            description: "Session metadata and messages",
            content: {
              "application/json": {
                schema: resolver(z.object({
                  session: z.unknown(),
                  messages: z.unknown().array(),
                })),
              },
            },
          },
          ...errors(404),
        },
      }),
      validator("param", z.object({ sessionID: z.string() })),
      async (c) => {
        const sessionID = c.req.valid("param").sessionID
        const session = await Session.get(sessionID)
        const messages = await Session.messages({ sessionID })

        return c.json({
          session: {
            id: session.id,
            title: session.title,
            time: session.time,
          },
          messages,
        })
      },
    ),
)
