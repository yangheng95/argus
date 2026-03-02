import z from "zod"
import { Tool } from "./tool"
import { Goal } from "@/session/goal"

const DESCRIPTION = `Manage persistent session goals that keep the agent working until achieved.

**Blocking goals** prevent the agent from entering standby — the Goal Sentinel will force continuation until the goal is achieved or max attempts are reached.

**Advisory goals** are tracked but do not block standby.

Actions:
- **set_goal**: Create a new goal with description, criteria, optional verify_cmd
- **update_goal**: Change goal status, description, or criteria
- **list_goals**: View all goals for this session
- **remove_goal**: Delete a goal`

export const GoalTool = Tool.define("goal", {
  description: DESCRIPTION,
  parameters: z.discriminatedUnion("action", [
    z.object({
      action: z.literal("set_goal"),
      description: z.string().describe("What this goal should accomplish"),
      criteria: z.string().describe("Specific success criteria to evaluate achievement"),
      verify_cmd: z.string().optional().describe("Shell command to verify goal — exit 0 means achieved"),
      priority: z.enum(["blocking", "advisory"]).optional().describe("blocking (default) prevents standby, advisory is tracked only"),
      max_attempts: z.number().int().min(1).max(100).optional().describe("Max evaluation attempts before deadlock (default 10)"),
    }),
    z.object({
      action: z.literal("update_goal"),
      goalId: z.string().describe("Goal ID to update"),
      status: z.enum(["active", "achieved", "failed", "cancelled"]).optional(),
      description: z.string().optional().describe("Updated description"),
      criteria: z.string().optional().describe("Updated success criteria"),
    }),
    z.object({
      action: z.literal("list_goals"),
    }),
    z.object({
      action: z.literal("remove_goal"),
      goalId: z.string().describe("Goal ID to remove"),
    }),
  ]),
  async execute(params, ctx) {
    const sessionID = ctx.sessionID

    await ctx.ask({
      permission: "goal",
      patterns: ["*"],
      always: ["*"],
      metadata: { action: params.action },
    })

    switch (params.action) {
      case "set_goal": {
        const goal = Goal.add({
          sessionID,
          description: params.description,
          criteria: params.criteria,
          verifyCmd: params.verify_cmd,
          priority: params.priority as Goal.Priority | undefined,
          maxAttempts: params.max_attempts,
        })
        return {
          title: `Goal set: ${params.description.slice(0, 50)}`,
          output: JSON.stringify({
            id: goal.id,
            description: goal.description,
            criteria: goal.criteria,
            priority: goal.priority,
            status: goal.status,
            maxAttempts: goal.maxAttempts,
          }),
          metadata: {},
        }
      }

      case "update_goal": {
        const changes: Parameters<typeof Goal.update>[1] = {}
        if (params.status) changes.status = params.status
        if (params.description) changes.description = params.description
        if (params.criteria) changes.criteria = params.criteria

        const updated = Goal.update(params.goalId, changes)
        if (!updated) {
          return {
            title: "Goal not found",
            output: JSON.stringify({ error: `Goal ${params.goalId} not found` }),
            metadata: {},
          }
        }
        return {
          title: `Updated: ${updated.description.slice(0, 50)}`,
          output: JSON.stringify({
            id: updated.id,
            description: updated.description,
            criteria: updated.criteria,
            status: updated.status,
            priority: updated.priority,
          }),
          metadata: {},
        }
      }

      case "list_goals": {
        const goals = Goal.list(sessionID)
        const markdown = Goal.toMarkdown(sessionID)
        return {
          title: `${goals.length} goals`,
          output: JSON.stringify({
            count: goals.length,
            summary: markdown ?? "(no goals)",
            goals: goals.map((g) => ({
              id: g.id,
              description: g.description,
              criteria: g.criteria,
              status: g.status,
              priority: g.priority,
              currentAttempts: g.currentAttempts,
              maxAttempts: g.maxAttempts,
            })),
          }),
          metadata: {},
        }
      }

      case "remove_goal": {
        const existing = Goal.get(params.goalId)
        if (!existing) {
          return {
            title: "Goal not found",
            output: JSON.stringify({ error: `Goal ${params.goalId} not found` }),
            metadata: {},
          }
        }
        Goal.remove(params.goalId)
        return {
          title: `Removed: ${existing.description.slice(0, 50)}`,
          output: JSON.stringify({ removed: true, id: params.goalId }),
          metadata: {},
        }
      }
    }
  },
})
