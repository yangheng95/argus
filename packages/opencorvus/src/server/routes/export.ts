import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Session } from "@/session"
import { Trace } from "@/trace"
import { errors } from "../error"
import { lazy } from "../../util/lazy"
import {
  findDeliveryByRun,
  findEvaluationByRun,
  findPlan,
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
} from "@/engine/store"
import { Task } from "@/engine/model"

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
                  task: z.any(),
                  plan: z.any().optional(),
                  goals: z.any().array(),
                  milestones: z.any().array(),
                  runs: z.any().array(),
                  interactions: z.any().array(),
                  snapshots: z.any().array(),
                  deliveries: z.any().array(),
                  evaluations: z.any().array(),
                  artifacts: z.any().array(),
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
        const plan = task.active_plan_version_id ? findPlan(task.active_plan_version_id) : undefined
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
          goals: goals.map(viewGoal),
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
                  session: z.any(),
                  messages: z.any().array(),
                  llm_calls: z.number().int(),
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
        const traceTaskID = Trace.taskIDForSession(sessionID)
        const events = traceTaskID ? await Trace.read(traceTaskID).catch(() => []) : []

        return c.json({
          session: {
            id: session.id,
            title: session.title,
            time: session.time,
          },
          messages,
          trace_events: events.length,
        })
      },
    ),
)
