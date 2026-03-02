import z from "zod"
import { Tool } from "./tool"
import { TaskPlan } from "@/memory/task-plan"
import { Scratchpad } from "@/memory/scratchpad"

/**
 * Planner tool — task decomposition + working memory.
 *
 * Provides structured goal management (hierarchical tasks) and
 * a scratchpad for intermediate reasoning notes.
 */
const DESCRIPTION = `Task planner with working memory for complex multi-step goals.

**Task Planning** — decompose goals into a tree of subtasks, track status and progress:
- **add_task**: Create a task (optionally as a subtask of an existing task)
- **update_task**: Change task status, notes, or progress
- **list_tasks**: View all tasks for this session

**Working Memory** — scratchpad for intermediate thoughts and reasoning:
- **scratchpad_write**: Replace scratchpad content
- **scratchpad_append**: Append to scratchpad
- **scratchpad_read**: Read current scratchpad`

export const PlannerTool = Tool.define("planner", {
  description: DESCRIPTION,
  parameters: z.discriminatedUnion("action", [
    z.object({
      action: z.literal("add_task"),
      goal: z.string().describe("What this task should accomplish"),
      parentId: z.string().optional().describe("Parent task ID for subtasks"),
      priority: z.number().int().min(0).max(10).optional().describe("Priority 0-10 (higher = more important)"),
    }),
    z.object({
      action: z.literal("update_task"),
      taskId: z.string().describe("Task ID to update"),
      status: z.enum(["pending", "in_progress", "completed", "blocked", "cancelled"]).optional(),
      notes: z.string().optional().describe("Update task notes"),
      progressPct: z.number().int().min(0).max(100).optional().describe("Progress percentage 0-100"),
    }),
    z.object({
      action: z.literal("list_tasks"),
    }),
    z.object({
      action: z.literal("scratchpad_write"),
      content: z.string().describe("Content to write (replaces existing)"),
    }),
    z.object({
      action: z.literal("scratchpad_append"),
      content: z.string().describe("Content to append"),
    }),
    z.object({
      action: z.literal("scratchpad_read"),
    }),
  ]),
  async execute(params, ctx) {
    const sessionID = ctx.sessionID

    await ctx.ask({
      permission: "planner",
      patterns: ["*"],
      always: ["*"],
      metadata: { action: params.action },
    })

    switch (params.action) {
      case "add_task": {
        const task = TaskPlan.add({
          sessionID,
          parentID: params.parentId,
          goal: params.goal,
          priority: params.priority,
        })
        return {
          title: `Task added: ${params.goal.slice(0, 50)}`,
          output: JSON.stringify({
            id: task.id,
            goal: task.goal,
            parentID: task.parentID,
            status: task.status,
          }),
          metadata: {},
        }
      }

      case "update_task": {
        const updated = TaskPlan.update(params.taskId, {
          status: params.status,
          notes: params.notes,
          progressPct: params.progressPct,
        })
        if (!updated) {
          return {
            title: "Task not found",
            output: JSON.stringify({ error: `Task ${params.taskId} not found` }),
            metadata: {},
          }
        }
        return {
          title: `Updated: ${updated.goal.slice(0, 50)}`,
          output: JSON.stringify({
            id: updated.id,
            goal: updated.goal,
            status: updated.status,
            progressPct: updated.progressPct,
            notes: updated.notes,
          }),
          metadata: {},
        }
      }

      case "list_tasks": {
        const tasks = TaskPlan.list(sessionID)
        const markdown = TaskPlan.toMarkdown(sessionID)
        return {
          title: `${tasks.length} tasks`,
          output: JSON.stringify({
            count: tasks.length,
            tree: markdown ?? "(no tasks)",
            tasks: tasks.map((t) => ({
              id: t.id,
              goal: t.goal,
              status: t.status,
              parentID: t.parentID,
              progressPct: t.progressPct,
              notes: t.notes,
            })),
          }),
          metadata: {},
        }
      }

      case "scratchpad_write": {
        Scratchpad.set(sessionID, params.content)
        return {
          title: "Scratchpad updated",
          output: JSON.stringify({ written: true, length: params.content.length }),
          metadata: {},
        }
      }

      case "scratchpad_append": {
        Scratchpad.append(sessionID, params.content)
        const full = Scratchpad.get(sessionID)
        return {
          title: "Scratchpad appended",
          output: JSON.stringify({ appended: true, totalLength: full.length }),
          metadata: {},
        }
      }

      case "scratchpad_read": {
        const content = Scratchpad.get(sessionID)
        return {
          title: content ? "Scratchpad content" : "Scratchpad empty",
          output: JSON.stringify({ content: content || "(empty)" }),
          metadata: {},
        }
      }
    }
  },
})
