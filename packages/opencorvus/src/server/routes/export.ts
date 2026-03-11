import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"
import { Session } from "@/session"
import { LLMTrace } from "@/session/llm-trace"
import { errors } from "../error"
import { lazy } from "../../util/lazy"
import {
  findDeliveries,
  findEvaluations,
  findPlan,
  findRuns,
  findSpecSnapshot,
  listGoalsBySpec,
  listGoalRunsByTask,
  listInteractions,
  listMilestones,
  listPlanNodesByPlan,
  listSnapshots,
  requireTask,
  viewDelivery,
  viewEvaluation,
  viewGoal,
  viewInteraction,
  viewMilestone,
  viewPlan,
  viewPlanNode,
  viewRun,
  viewSnapshot,
  viewSpecSnapshot,
  viewTask,
  viewGoalRun,
  findArtifacts,
  viewArtifact,
} from "@/orchestrator/store"
import { Task, TaskExport } from "@/orchestrator/model"

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
                schema: resolver(TaskExport),
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
        const spec = task.active_spec_version_id ? findSpecSnapshot(task.active_spec_version_id) : undefined
        const plan = task.active_plan_version_id ? findPlan(task.active_plan_version_id) : undefined
        const specSnapshotID = plan?.spec_snapshot_id ?? task.active_spec_version_id ?? undefined
        const goals = specSnapshotID ? listGoalsBySpec(specSnapshotID) : []
        const planNodes = plan ? listPlanNodesByPlan(plan.id) : []
        const goalRuns = listGoalRunsByTask(taskID)
        const milestones = listMilestones(taskID)
        const runs = findRuns(taskID)
        const coordinatorRun = task.active_run_id
          ? runs.find((run) => run.id === task.active_run_id)
          : runs[0]
        const interactions = listInteractions(taskID)
        const snapshots = listSnapshots(taskID)

        // 收集所有 run 的 delivery、evaluation、artifact
        const deliveries: ReturnType<typeof viewDelivery>[] = []
        const evaluations: ReturnType<typeof viewEvaluation>[] = []
        const artifacts: ReturnType<typeof viewArtifact>[] = []
        for (const run of runs) {
          deliveries.push(...findDeliveries(run.id).map(viewDelivery))
          evaluations.push(...findEvaluations(run.id).map(viewEvaluation))
          artifacts.push(...findArtifacts(run.id).map(viewArtifact))
        }

        return c.json({
          task: viewTask(task),
          spec: spec ? viewSpecSnapshot(spec) : undefined,
          plan: plan ? viewPlan(plan) : undefined,
          coordinatorRun: coordinatorRun ? viewRun(coordinatorRun) : undefined,
          goals: goals.map(viewGoal),
          planNodes: planNodes.map(viewPlanNode),
          goalRuns: goalRuns.map(viewGoalRun),
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
        const calls = await LLMTrace.read(sessionID).catch(() => [])

        return c.json({
          session: {
            id: session.id,
            title: session.title,
            time: session.time,
          },
          messages,
          llm_calls: calls.length,
        })
      },
    ),
)
