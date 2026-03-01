import { Database, eq, and } from "@/storage/db"
import { GoalTable } from "./goal.sql"
import { Identifier } from "@/id/id"
import { Log } from "@/util/log"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Provider } from "@/provider/provider"
import { generateObject } from "ai"
import { MessageV2 } from "./message"
import z from "zod"
import { spawn } from "child_process"
import JUDGE_PROMPT from "../agent/prompt/judge.txt"

/**
 * Goal Sentinel — persistent goals with evaluation cascade.
 *
 * Goals are session-scoped objectives that prevent the agent from entering
 * standby until achieved. The evaluation cascade:
 *   1. Programmatic check (verify_cmd exit code)
 *   2. Judge LLM evaluation (small model, independent persona)
 *   3. Deadlock detection (max attempts exceeded)
 */
export namespace Goal {
  const log = Log.create({ service: "goal" })

  // ── Types ──────────────────────────────────────────────────────

  export type Status = "active" | "achieved" | "failed" | "cancelled"
  export type Priority = "blocking" | "advisory"

  export interface Info {
    id: string
    sessionID: string
    description: string
    criteria: string
    verifyCmd: string | null
    status: Status
    priority: Priority
    maxAttempts: number
    currentAttempts: number
    progressLog: EvaluationEntry[]
    timeCreated: number
    timeUpdated: number
  }

  export interface EvaluationEntry {
    attempt: number
    timestamp: number
    action: "achieved" | "continue" | "deadlock"
    confidence: number
    reasoning: string
    nextStep: string | null
  }

  export const EvaluationResult = z.object({
    achieved: z.boolean(),
    confidence: z.number().min(0).max(1),
    reasoning: z.string(),
    nextStep: z.string().nullable(),
    deadlock: z.boolean(),
  })
  export type EvaluationResult = z.infer<typeof EvaluationResult>

  // ── Events ─────────────────────────────────────────────────────

  export const Event = {
    Updated: BusEvent.define(
      "goal.updated",
      z.object({
        goal: z.object({
          id: z.string(),
          sessionID: z.string(),
          description: z.string(),
          status: z.string(),
        }),
      }),
    ),
    Deadlock: BusEvent.define(
      "goal.deadlock",
      z.object({
        goal: z.object({
          id: z.string(),
          sessionID: z.string(),
          description: z.string(),
          attempts: z.number(),
        }),
      }),
    ),
  }

  // ── Row mapping ────────────────────────────────────────────────

  function fromRow(row: typeof GoalTable.$inferSelect): Info {
    let progressLog: EvaluationEntry[] = []
    try {
      progressLog = JSON.parse(row.progress_log || "[]")
    } catch {
      progressLog = []
    }
    return {
      id: row.id,
      sessionID: row.session_id,
      description: row.description,
      criteria: row.criteria,
      verifyCmd: row.verify_cmd,
      status: row.status as Status,
      priority: row.priority as Priority,
      maxAttempts: row.max_attempts,
      currentAttempts: row.current_attempts,
      progressLog,
      timeCreated: row.time_created,
      timeUpdated: row.time_updated,
    }
  }

  // ── CRUD ───────────────────────────────────────────────────────

  export function add(input: {
    sessionID: string
    description: string
    criteria: string
    verifyCmd?: string
    priority?: Priority
    maxAttempts?: number
  }): Info {
    const id = Identifier.ascending("goal")
    Database.use((db) =>
      db
        .insert(GoalTable)
        .values({
          id,
          session_id: input.sessionID,
          description: input.description,
          criteria: input.criteria,
          verify_cmd: input.verifyCmd ?? null,
          priority: input.priority ?? "blocking",
          max_attempts: input.maxAttempts ?? 10,
        })
        .run(),
    )
    const goal = get(id)!
    log.info("goal added", { id, description: input.description })
    Bus.publish(Event.Updated, {
      goal: { id, sessionID: input.sessionID, description: input.description, status: "active" },
    })
    return goal
  }

  export function get(goalID: string): Info | null {
    const row = Database.use((db) =>
      db.select().from(GoalTable).where(eq(GoalTable.id, goalID)).get(),
    )
    return row ? fromRow(row) : null
  }

  export function update(
    goalID: string,
    changes: Partial<Pick<Info, "status" | "description" | "criteria" | "currentAttempts" | "progressLog">>,
  ): Info | null {
    const existing = get(goalID)
    if (!existing) return null

    const set: Record<string, unknown> = {}
    if (changes.status !== undefined) set.status = changes.status
    if (changes.description !== undefined) set.description = changes.description
    if (changes.criteria !== undefined) set.criteria = changes.criteria
    if (changes.currentAttempts !== undefined) set.current_attempts = changes.currentAttempts
    if (changes.progressLog !== undefined) set.progress_log = JSON.stringify(changes.progressLog)

    if (Object.keys(set).length > 0) {
      Database.use((db) =>
        db.update(GoalTable).set(set).where(eq(GoalTable.id, goalID)).run(),
      )
    }

    const updated = get(goalID)!
    log.info("goal updated", { id: goalID, changes: Object.keys(set) })
    Bus.publish(Event.Updated, {
      goal: {
        id: goalID,
        sessionID: updated.sessionID,
        description: updated.description,
        status: updated.status,
      },
    })
    return updated
  }

  export function remove(goalID: string): void {
    Database.use((db) =>
      db.delete(GoalTable).where(eq(GoalTable.id, goalID)).run(),
    )
    log.info("goal removed", { id: goalID })
  }

  export function list(sessionID: string): Info[] {
    const rows = Database.use((db) =>
      db
        .select()
        .from(GoalTable)
        .where(eq(GoalTable.session_id, sessionID))
        .all(),
    )
    return rows.map(fromRow)
  }

  export function listActive(sessionID: string): Info[] {
    const rows = Database.use((db) =>
      db
        .select()
        .from(GoalTable)
        .where(and(eq(GoalTable.session_id, sessionID), eq(GoalTable.status, "active")))
        .all(),
    )
    return rows.map(fromRow)
  }

  // ── Evaluation cascade ─────────────────────────────────────────

  /**
   * Run verify_cmd and check exit code. Returns true if exit 0.
   * Returns null if no verify_cmd is set.
   */
  export async function programmaticCheck(goal: Info): Promise<boolean | null> {
    if (!goal.verifyCmd) return null

    return new Promise<boolean>((resolve) => {
      const proc = spawn(goal.verifyCmd!, [], {
        shell: true,
        cwd: process.cwd(),
        timeout: 30_000,
        stdio: "pipe",
      })

      proc.on("close", (code) => {
        log.info("programmatic check", { goalID: goal.id, cmd: goal.verifyCmd, exitCode: code })
        resolve(code === 0)
      })

      proc.on("error", (err) => {
        log.warn("programmatic check error", { goalID: goal.id, err })
        resolve(false)
      })
    })
  }

  /**
   * Use a small LLM (Judge persona) to evaluate goal achievement.
   */
  export async function judgeEvaluation(
    goal: Info,
    messages: MessageV2.WithParts[],
    providerID: string,
  ): Promise<EvaluationResult> {
    // Use the same provider but try to get a small/fast model
    const modelInfo = await Provider.getModel(providerID, "claude-haiku-4-5-20251001").catch(async () => {
      // Fallback: use default model if haiku not available
      const def = await Provider.defaultModel()
      return Provider.getModel(def.providerID, def.modelID)
    })
    const model = await Provider.getLanguage(modelInfo)

    // Build a condensed conversation summary for the judge (last 10 messages)
    const recentMessages = messages.slice(-10)
    const conversationSummary = recentMessages
      .map((m) => {
        const role = m.info.role
        const textParts = m.parts
          .filter((p): p is MessageV2.TextPart => p.type === "text")
          .map((p) => p.text)
          .join("\n")
        const toolParts = m.parts
          .filter((p): p is MessageV2.ToolPart => p.type === "tool")
          .map((p) => {
            const output = p.state.status === "completed" ? p.state.output : ""
            return `[Tool ${p.tool}: ${output.slice(0, 500)}]`
          })
          .join("\n")
        return `[${role}] ${textParts}\n${toolParts}`.trim()
      })
      .filter(Boolean)
      .join("\n---\n")

    const userPrompt = `## Goal to evaluate

**Description**: ${goal.description}

**Success criteria**: ${goal.criteria}

**Attempt**: ${goal.currentAttempts + 1} of ${goal.maxAttempts}

## Recent conversation

${conversationSummary}

## Your judgment

Evaluate whether the goal has been achieved based on the evidence above.`

    try {
      const result = await generateObject({
        model,
        temperature: 0,
        messages: [
          { role: "system", content: JUDGE_PROMPT },
          { role: "user", content: userPrompt },
        ],
        schema: EvaluationResult,
      })
      log.info("judge evaluation", {
        goalID: goal.id,
        achieved: result.object.achieved,
        confidence: result.object.confidence,
        deadlock: result.object.deadlock,
      })
      return result.object
    } catch (err) {
      log.warn("judge evaluation failed, defaulting to continue", { goalID: goal.id, err })
      return {
        achieved: false,
        confidence: 0,
        reasoning: "Judge evaluation failed due to an error. Defaulting to continue.",
        nextStep: "Review the goal criteria and retry.",
        deadlock: false,
      }
    }
  }

  /**
   * Full evaluation cascade for a single goal:
   *   1. programmaticCheck (if verify_cmd set)
   *   2. judgeEvaluation (LLM judge)
   *   3. deadlock detection (max attempts)
   *
   * Returns the action to take: "achieved", "continue", or "deadlock".
   */
  export async function evaluate(
    goal: Info,
    messages: MessageV2.WithParts[],
    providerID: string,
  ): Promise<{ action: "achieved" | "continue" | "deadlock"; result: EvaluationResult }> {
    // Step 1: Programmatic check
    const cmdResult = await programmaticCheck(goal)
    if (cmdResult === true) {
      const result: EvaluationResult = {
        achieved: true,
        confidence: 1.0,
        reasoning: `verify_cmd "${goal.verifyCmd}" exited with code 0`,
        nextStep: null,
        deadlock: false,
      }
      return { action: "achieved", result }
    }

    // Step 2: Judge LLM evaluation
    const judgeResult = await judgeEvaluation(goal, messages, providerID)

    if (judgeResult.achieved && judgeResult.confidence >= 0.8) {
      return { action: "achieved", result: judgeResult }
    }

    // Step 3: Deadlock detection
    if (judgeResult.deadlock || goal.currentAttempts + 1 >= goal.maxAttempts) {
      return {
        action: "deadlock",
        result: {
          ...judgeResult,
          deadlock: true,
          reasoning: goal.currentAttempts + 1 >= goal.maxAttempts
            ? `Max attempts (${goal.maxAttempts}) reached. ${judgeResult.reasoning}`
            : judgeResult.reasoning,
        },
      }
    }

    return { action: "continue", result: judgeResult }
  }

  // ── System prompt injection ────────────────────────────────────

  /**
   * Build a markdown section for active goals in this session.
   * Returns null if no active goals exist.
   */
  export function toMarkdown(sessionID: string): string | null {
    const goals = listActive(sessionID)
    if (goals.length === 0) return null

    const lines: string[] = ["<session-goals>"]
    for (const goal of goals) {
      const icon = goal.priority === "blocking" ? "🚫" : "📋"
      const progress = goal.currentAttempts > 0
        ? ` (attempt ${goal.currentAttempts}/${goal.maxAttempts})`
        : ""
      lines.push(`${icon} **${goal.description}**${progress} [${goal.id}]`)
      lines.push(`  Criteria: ${goal.criteria}`)
      if (goal.verifyCmd) lines.push(`  Verify: \`${goal.verifyCmd}\``)

      // Show last evaluation entry if any
      const lastEntry = goal.progressLog[goal.progressLog.length - 1]
      if (lastEntry?.nextStep) {
        lines.push(`  Next step: ${lastEntry.nextStep}`)
      }
    }
    lines.push("</session-goals>")
    lines.push("")
    lines.push("You have active goals above. Keep working toward them. Use the goal tool to manage goals.")

    return lines.join("\n")
  }
}
