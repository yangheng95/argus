import { Instance } from "@/project/instance"
import { Database, desc, eq, and, like } from "@/storage/db"
import { EngineTaskTable, EngineEvaluationTable, EngineGoalTable } from "@/engine"
import { goalStatusByID } from "@/engine/describe"
import { Tool } from "./tool"
import z from "zod"

const DESCRIPTION = `Query orchestrator analytics for task history, completion rates, and performance metrics.

Actions:
- **summary**: Get aggregate statistics for the current project (total tasks, pass rate, median completion time).
- **search**: Search tasks by title/request text, status, or date range.
- **goal_stats**: Get goal pass/fail statistics across all tasks.`

export const AnalyticsTool = Tool.define("analytics", {
  description: DESCRIPTION,
  parameters: z.discriminatedUnion("action", [
    z.object({
      action: z.literal("summary"),
    }),
    z.object({
      action: z.literal("search"),
      query: z.string().optional().describe("Text to search in task title or request"),
      status: z
        .enum(["queued", "active", "completed", "failed", "cancelled"])
        .optional()
        .describe("Filter by task status"),
      limit: z.number().int().positive().default(20).describe("Max results"),
    }),
    z.object({
      action: z.literal("goal_stats"),
    }),
  ]),
  async execute(args) {
    const projectID = Instance.project.id

    if (args.action === "summary") {
      const tasks = Database.use((db) =>
        db.select().from(EngineTaskTable).where(eq(EngineTaskTable.project_id, projectID)).all(),
      )
      const total = tasks.length
      const completed = tasks.filter((t) => t.status === "completed").length
      const failed = tasks.filter((t) => t.status === "failed").length
      const running = tasks.filter((t) => t.status === "active").length
      const blocked = 0

      // 计算完成时间中位数
      const durations = tasks
        .filter((t) => t.time_started && t.time_completed)
        .map((t) => (t.time_completed ?? 0) - (t.time_started ?? 0))
        .filter((d) => d > 0)
        .sort((a, b) => a - b)
      const median = durations.length > 0 ? durations[Math.floor((durations.length - 1) / 2)] : null

      // 评估通过率
      const evals = Database.use((db) =>
        db
          .select()
          .from(EngineEvaluationTable)
          .innerJoin(EngineTaskTable, eq(EngineEvaluationTable.task_id, EngineTaskTable.id))
          .where(eq(EngineTaskTable.project_id, projectID))
          .all(),
      )
      const totalEvals = evals.length
      const passedEvals = evals.filter((e) => e.engine_evaluation.status === "passed").length

      return {
        title: "Project Analytics Summary",
        metadata: {},
        output: JSON.stringify({
          total_tasks: total,
          completed,
          failed,
          running,
          blocked,
          pass_rate: total > 0 ? `${Math.round((completed / total) * 100)}%` : "N/A",
          evaluation_pass_rate: totalEvals > 0 ? `${Math.round((passedEvals / totalEvals) * 100)}%` : "N/A",
          median_completion_ms: median,
          median_completion_readable: median ? `${Math.round(median / 1000)}s` : "N/A",
        }, null, 2),
      }
    }

    if (args.action === "search") {
      const limit = args.limit
      const conditions = [eq(EngineTaskTable.project_id, projectID)]
      if (args.status) conditions.push(eq(EngineTaskTable.status, args.status))
      if (args.query) conditions.push(like(EngineTaskTable.title, `%${args.query}%`))

      const tasks = Database.use((db) =>
        db
          .select()
          .from(EngineTaskTable)
          .where(and(...conditions))
          .orderBy(desc(EngineTaskTable.time_updated))
          .limit(limit)
          .all(),
      )

      const results = tasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        created: new Date(t.time_created).toISOString(),
        updated: new Date(t.time_updated).toISOString(),
        duration_ms: t.time_started && t.time_completed ? (t.time_completed - t.time_started) : null,
      }))

      return {
        title: `Found ${results.length} task(s)`,
        metadata: {},
        output: JSON.stringify(results, null, 2),
      }
    }

    if (args.action === "goal_stats") {
      const goals = Database.use((db) =>
        db
          .select()
          .from(EngineGoalTable)
          .innerJoin(EngineTaskTable, eq(EngineGoalTable.task_id, EngineTaskTable.id))
          .where(eq(EngineTaskTable.project_id, projectID))
          .all(),
      )
      const total = goals.length
      const passed = goals.filter((g) => goalStatusByID(g.engine_goal.id) === "passed").length
      const failed = goals.filter((g) => goalStatusByID(g.engine_goal.id) === "failed").length
      const pending = goals.filter((g) => goalStatusByID(g.engine_goal.id) === "pending").length
      const blocking = goals.filter((g) => g.engine_goal.priority === "blocking").length
      const advisory = goals.filter((g) => g.engine_goal.priority === "advisory").length

      return {
        title: "Goal Statistics",
        metadata: {},
        output: JSON.stringify({
          total_goals: total,
          passed,
          failed,
          pending,
          blocking,
          advisory,
          pass_rate: total > 0 ? `${Math.round((passed / total) * 100)}%` : "N/A",
        }, null, 2),
      }
    }

    return { title: "Unknown action", metadata: {}, output: "Unknown analytics action" }
  },
})
